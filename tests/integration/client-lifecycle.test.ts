import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createServer } from 'node:http'
import { parse } from 'node:url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { generateOccurrences } from '../../src/modules/scheduling/recurrence'
import { cleanOperations, getAuthCookie, seedUsers } from './setup'

let app: ReturnType<typeof createServer>
let nextApp: ReturnType<typeof next>
let adminCookie: string

beforeAll(async () => {
  process.env.NEXT_TEST_DIST_DIR = '.next-integration'
  nextApp = next({ dev: true, dir: process.cwd() })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()
  app = createServer((req, res) => handle(req, res, parse(req.url!, true)))
  await seedUsers()
  adminCookie = await getAuthCookie('admin@ds.ie')
}, 30_000)

beforeEach(() => cleanOperations())
afterAll(async () => {
  await cleanOperations()
  await nextApp.close()
})

function futureStart(days = 7) {
  const date = new Date(Date.now() + days * 86_400_000)
  date.setUTCHours(9, 0, 0, 0)
  return date
}

async function createAccount(name: string) {
  const response = await request(app).post('/api/client-accounts').set('Cookie', adminCookie).send({
    client: {
      displayName: name,
      type: 'commercial',
      contacts: [{ name: 'Primary contact', email: `${name.replaceAll(' ', '.').toLowerCase()}@example.ie`, isPrimary: true }],
    },
    location: {
      name: 'Main site',
      addressLine1: '1 Lifecycle Street',
      city: 'Dublin',
      postalCode: 'D02 LIFE',
      countryCode: 'IE',
      timezone: 'Europe/Dublin',
      latitude: 53.3451,
      longitude: -6.2811,
      coordinateSource: 'geocoded',
      access: { entryInstructions: 'Use reception.' },
    },
  })
  expect(response.status).toBe(201)
  return response.body.data as { id: string; version: number; sites: Array<{ id: string }> }
}

async function createService(
  clientId: string,
  siteId: string,
  start = futureStart(),
  end = new Date(start.getTime() + 30 * 86_400_000),
) {
  const response = await request(app)
    .post(`/api/client-accounts/${clientId}/service`)
    .set('Cookie', adminCookie)
    .send({
      siteId,
      serviceName: 'Lifecycle cleaning',
      startAt: start.toISOString(),
      endDate: end.toISOString(),
      expectedDurationMinutes: 60,
      requiredWorkers: 1,
      tasks: ['Clean floors'],
      recurrence: { frequency: 'daily', interval: 1 },
      instructions: 'Lifecycle acceptance service.',
    })
  expect(response.status).toBe(201)
  return response.body.data as { servicePlanId: string; jobId: string; generatedVisits: number }
}

describe('client lifecycle safety', () => {
  it('creates the client and first verified location atomically', async () => {
    const beforeClients = await prisma.client.count()
    const beforeSites = await prisma.site.count()

    const created = await createAccount('Atomic Client')
    expect(await prisma.client.count()).toBe(beforeClients + 1)
    expect(await prisma.site.count({ where: { clientId: created.id } })).toBe(1)

    const invalid = await request(app).post('/api/client-accounts').set('Cookie', adminCookie).send({
      client: { displayName: 'Invalid Atomic Client', type: 'commercial' },
      location: {
        name: 'Broken location',
        addressLine1: 'Missing coordinate street',
        city: 'Dublin',
        postalCode: 'D02 BAD',
        countryCode: 'IE',
        timezone: 'Europe/Dublin',
        coordinateSource: 'geocoded',
      },
    })
    expect(invalid.status).toBe(400)
    expect(await prisma.client.count({ where: { displayName: 'Invalid Atomic Client' } })).toBe(0)
    expect(await prisma.site.count()).toBe(beforeSites + 1)
  })

  it('keeps a future-dated service active until its boundary and preserves manual extras and history', async () => {
    const client = await createAccount('Future End Client')
    const start = futureStart(7)
    const service = await createService(client.id, client.sites[0].id, start)

    const recurringVisits = await prisma.visit.findMany({
      where: { jobId: service.jobId },
      orderBy: { scheduledStart: 'asc' },
    })
    expect(recurringVisits.length).toBeGreaterThan(5)

    const completed = recurringVisits[0]
    await prisma.visit.update({
      where: { id: completed.id },
      data: { status: 'completed', completedAt: new Date(), startedAt: completed.scheduledStart },
    })

    const boundary = new Date(start.getTime() + 3 * 86_400_000)
    const extraStart = new Date(boundary.getTime() + 86_400_000)
    const extra = await request(app).post('/api/visits').set('Cookie', adminCookie).send({
      servicePlanId: service.servicePlanId,
      scheduledStart: extraStart.toISOString(),
      durationMinutes: 60,
      requiredWorkers: 1,
      reason: 'client_request',
      dispatchNotes: 'Manual extra must survive service end.',
    })
    expect(extra.status).toBe(201)
    const extraVisitId = extra.body.data.id as string

    const preview = await request(app)
      .post(`/api/client-accounts/${client.id}/service-end?preview=true`)
      .set('Cookie', adminCookie)
      .send({ servicePlanId: service.servicePlanId, effectiveFrom: boundary.toISOString(), reason: 'Contract ending' })
    expect(preview.status).toBe(200)
    expect(preview.body.data.canApply).toBe(true)
    expect(preview.body.data.futureRecurringVisits).toBeGreaterThan(0)
    expect(preview.body.data.manualExtraVisits).toBe(1)

    const applied = await request(app)
      .post(`/api/client-accounts/${client.id}/service-end`)
      .set('Cookie', adminCookie)
      .send({ servicePlanId: service.servicePlanId, effectiveFrom: boundary.toISOString(), reason: 'Contract ending' })
    expect(applied.status).toBe(200)

    const rejectedPostEndExtra = await request(app).post('/api/visits').set('Cookie', adminCookie).send({
      servicePlanId: service.servicePlanId,
      scheduledStart: new Date(boundary.getTime() + 2 * 86_400_000).toISOString(),
      durationMinutes: 60,
      requiredWorkers: 1,
      reason: 'client_request',
    })
    expect(rejectedPostEndExtra.status).toBe(409)
    expect(rejectedPostEndExtra.body.code).toBe('SERVICE_ENDED')

    const postEndFrom = new Date(boundary.getTime() + 86_400_000)
    const postEndTo = new Date(boundary.getTime() + 5 * 86_400_000)
    const postEndSchedule = await request(app)
      .get(`/api/schedule/bootstrap?from=${encodeURIComponent(postEndFrom.toISOString())}&to=${encodeURIComponent(postEndTo.toISOString())}`)
      .set('Cookie', adminCookie)
    expect(postEndSchedule.status).toBe(200)
    expect(postEndSchedule.body.data.plans.some((plan: { id: string }) => plan.id === service.servicePlanId)).toBe(false)

    const job = await prisma.job.findUniqueOrThrow({ where: { id: service.jobId } })
    expect(job.status).toBe('active')
    expect(job.endDate?.toISOString()).toBe(boundary.toISOString())

    expect((await prisma.visit.findUniqueOrThrow({ where: { id: completed.id } })).status).toBe('completed')
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: extraVisitId } })).status).toBe('scheduled')
    expect(await prisma.visit.count({
      where: { jobId: service.jobId, scheduledStart: { gte: boundary }, status: 'cancelled' },
    })).toBeGreaterThan(0)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'end_client_service', targetId: service.servicePlanId },
      orderBy: { createdAt: 'desc' },
    })
    expect(audit).not.toBeNull()
  })

  it('blocks a service end when operational work crosses the boundary', async () => {
    const client = await createAccount('Boundary Block Client')
    const start = futureStart(7)
    const service = await createService(client.id, client.sites[0].id, start)
    const visit = await prisma.visit.findFirstOrThrow({
      where: { jobId: service.jobId },
      orderBy: { scheduledStart: 'asc' },
    })
    const boundary = new Date(visit.scheduledStart.getTime() + 30 * 60_000)

    const preview = await request(app)
      .post(`/api/client-accounts/${client.id}/service-end?preview=true`)
      .set('Cookie', adminCookie)
      .send({ servicePlanId: service.servicePlanId, effectiveFrom: boundary.toISOString(), reason: 'Boundary test' })
    expect(preview.status).toBe(200)
    expect(preview.body.data.canApply).toBe(false)
    expect(preview.body.data.blockers.map((item: { id: string }) => item.id)).toContain(visit.id)

    const applied = await request(app)
      .post(`/api/client-accounts/${client.id}/service-end`)
      .set('Cookie', adminCookie)
      .send({ servicePlanId: service.servicePlanId, effectiveFrom: boundary.toISOString(), reason: 'Boundary test' })
    expect(applied.status).toBe(409)
    expect((await prisma.job.findUniqueOrThrow({ where: { id: service.jobId } })).status).toBe('active')
  })

  it('ends beyond the current generation horizon without eager materialization or a false version conflict', async () => {
    const client = await createAccount('Long Horizon End Client')
    const start = futureStart(7)
    const contractualEnd = new Date(start.getTime() + 180 * 86_400_000)
    const service = await createService(client.id, client.sites[0].id, start, contractualEnd)
    const before = await prisma.job.findUniqueOrThrow({ where: { id: service.jobId } })
    const boundary = new Date(start.getTime() + 120 * 86_400_000)

    expect(before.generatedThrough).not.toBeNull()
    expect(before.generatedThrough!.getTime()).toBeLessThan(boundary.getTime())
    const visitsBefore = await prisma.visit.count({ where: { jobId: service.jobId } })

    const preview = await request(app)
      .post(`/api/client-accounts/${client.id}/service-end?preview=true`)
      .set('Cookie', adminCookie)
      .send({ servicePlanId: service.servicePlanId, effectiveFrom: boundary.toISOString(), reason: 'Long contract ending' })
    expect(preview.status).toBe(200)
    expect(preview.body.data.canApply).toBe(true)
    expect(preview.body.data.futureRecurringVisits).toBe(0)
    expect(preview.body.data.futureRecurringObligations).toBeGreaterThan(0)

    const applied = await request(app)
      .post(`/api/client-accounts/${client.id}/service-end`)
      .set('Cookie', adminCookie)
      .send({ servicePlanId: service.servicePlanId, effectiveFrom: boundary.toISOString(), reason: 'Long contract ending' })
    expect(applied.status).toBe(200)

    const saved = await prisma.job.findUniqueOrThrow({ where: { id: service.jobId } })
    expect(saved.status).toBe('active')
    expect(saved.endDate?.toISOString()).toBe(boundary.toISOString())
    expect(await prisma.visit.count({ where: { jobId: service.jobId } })).toBe(visitsBefore)
  })

  it('blocks an unmaterialized recurring occurrence that crosses the service end boundary', async () => {
    const client = await createAccount('Synthetic Boundary Block Client')
    const start = futureStart(7)
    const contractualEnd = new Date(start.getTime() + 180 * 86_400_000)
    const service = await createService(client.id, client.sites[0].id, start, contractualEnd)
    const job = await prisma.job.findUniqueOrThrow({ where: { id: service.jobId } })
    const searchFrom = new Date(start.getTime() + 120 * 86_400_000)
    const occurrence = generateOccurrences({
      startAt: job.startDate,
      from: searchFrom,
      until: new Date(searchFrom.getTime() + 7 * 86_400_000),
      timezone: job.timezone,
      recurrence: { frequency: 'daily', interval: 1 },
      limit: 2,
    })[0]
    if (!occurrence) throw new Error('Expected a future recurring occurrence for the boundary regression.')
    const boundary = new Date(occurrence.getTime() + 30 * 60_000)

    expect(job.generatedThrough).not.toBeNull()
    expect(job.generatedThrough!.getTime()).toBeLessThan(occurrence.getTime())
    expect(await prisma.visit.findFirst({
      where: {
        jobId: service.jobId,
        scheduledStart: { lt: boundary },
        scheduledEnd: { gt: boundary },
      },
    })).toBeNull()

    const preview = await request(app)
      .post(`/api/client-accounts/${client.id}/service-end?preview=true`)
      .set('Cookie', adminCookie)
      .send({ servicePlanId: service.servicePlanId, effectiveFrom: boundary.toISOString(), reason: 'Boundary regression' })
    expect(preview.status).toBe(200)
    expect(preview.body.data.canApply).toBe(false)
    expect(preview.body.data.blockers.some((item: { id: string }) => item.id.startsWith('expected:'))).toBe(true)

    const applied = await request(app)
      .post(`/api/client-accounts/${client.id}/service-end`)
      .set('Cookie', adminCookie)
      .send({ servicePlanId: service.servicePlanId, effectiveFrom: boundary.toISOString(), reason: 'Boundary regression' })
    expect(applied.status).toBe(409)
    expect((await prisma.job.findUniqueOrThrow({ where: { id: service.jobId } })).endDate?.toISOString())
      .toBe(contractualEnd.toISOString())
  })

  it('refuses archive while work remains, then archives safely without deleting history', async () => {
    const client = await createAccount('Archive Lifecycle Client')
    const service = await createService(client.id, client.sites[0].id)
    const extraStart = futureStart(20)
    const extra = await request(app).post('/api/visits').set('Cookie', adminCookie).send({
      servicePlanId: service.servicePlanId,
      scheduledStart: extraStart.toISOString(),
      durationMinutes: 60,
      requiredWorkers: 1,
      reason: 'client_request',
    })
    expect(extra.status).toBe(201)

    const blocked = await request(app)
      .delete(`/api/clients/${client.id}?version=${client.version}`)
      .set('Cookie', adminCookie)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error).toMatch(/end all active services/i)

    const current = await prisma.client.findUniqueOrThrow({ where: { id: client.id } })
    const ended = await request(app)
      .post(`/api/client-accounts/${client.id}/service-end`)
      .set('Cookie', adminCookie)
      .send({ servicePlanId: service.servicePlanId, effectiveFrom: new Date().toISOString(), reason: 'Client relationship ended' })
    expect(ended.status).toBe(200)

    const scheduleFrom = new Date()
    const scheduleTo = new Date(scheduleFrom.getTime() + 35 * 86_400_000)
    const schedule = await request(app)
      .get(`/api/schedule/bootstrap?from=${encodeURIComponent(scheduleFrom.toISOString())}&to=${encodeURIComponent(scheduleTo.toISOString())}`)
      .set('Cookie', adminCookie)
    expect(schedule.status).toBe(200)
    expect(schedule.body.data.plans.some((plan: { id: string }) => plan.id === service.servicePlanId)).toBe(false)

    const rejectedExtra = await request(app).post('/api/visits').set('Cookie', adminCookie).send({
      servicePlanId: service.servicePlanId,
      scheduledStart: futureStart(25).toISOString(),
      durationMinutes: 60,
      requiredWorkers: 1,
      reason: 'client_request',
    })
    expect(rejectedExtra.status).toBe(409)
    expect(rejectedExtra.body.code).toBe('SERVICE_ENDED')

    await prisma.visit.update({
      where: { id: extra.body.data.id },
      data: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'Archive lifecycle test cleanup' },
    })

    const archived = await request(app)
      .delete(`/api/clients/${client.id}?version=${current.version}`)
      .set('Cookie', adminCookie)
    expect(archived.status).toBe(200)

    const savedClient = await prisma.client.findUniqueOrThrow({ where: { id: client.id } })
    expect(savedClient.archivedAt).not.toBeNull()
    expect(await prisma.visit.count({ where: { site: { clientId: client.id } } })).toBeGreaterThan(0)

    const activeClients = await request(app).get('/api/clients').set('Cookie', adminCookie)
    expect(activeClients.body.data.some((item: { id: string }) => item.id === client.id)).toBe(false)

    const archivedClients = await request(app).get('/api/clients?status=archived').set('Cookie', adminCookie)
    expect(archivedClients.body.data.some((item: { id: string; lifecycle: string }) => item.id === client.id && item.lifecycle === 'archived')).toBe(true)

    const account = await request(app).get(`/api/client-accounts/${client.id}`).set('Cookie', adminCookie)
    expect(account.status).toBe(200)
    expect(account.body.data.client.archivedAt).toBeTruthy()
    expect(account.body.data.client.sites.length).toBeGreaterThan(0)
    expect(account.body.data.recentVisits.length).toBeGreaterThan(0)

    const sites = await request(app).get('/api/sites').set('Cookie', adminCookie)
    expect(sites.body.data.some((item: { clientId: string }) => item.clientId === client.id)).toBe(false)

    const plans = await request(app).get('/api/service-plans').set('Cookie', adminCookie)
    expect(plans.body.data.some((item: { id: string }) => item.id === service.servicePlanId)).toBe(false)
  })
})
