import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { cleanOperations, getAuthCookie, seedUsers } from './setup'

let app: ReturnType<typeof createServer>
let nextApp: ReturnType<typeof next>
let adminCookie = ''
let employeeCookie = ''

beforeAll(async () => {
  process.env.NEXT_TEST_DIST_DIR = '.next-integration'
  nextApp = next({ dev: true, dir: process.cwd() })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()
  app = createServer((req, res) => handle(req, res, parse(req.url!, true)))
  await seedUsers()
  adminCookie = await getAuthCookie('admin@ds.ie')
  employeeCookie = await getAuthCookie('employee@ds.ie')
})

beforeEach(async () => {
  await cleanOperations()
  await prisma.recurringUnavailability.deleteMany()
  await prisma.studySchedule.deleteMany()
  await prisma.workforceLeave.deleteMany()
})

afterAll(async () => {
  await cleanOperations()
  await prisma.recurringUnavailability.deleteMany()
  await nextApp.close()
})

async function publishedPlan(requiredWorkers = 1) {
  const client = (await request(app).post('/api/clients').set('Cookie', adminCookie).send({ displayName: 'Schedule Hardening Client' })).body.data
  const site = (await request(app).post('/api/sites').set('Cookie', adminCookie).send({
    clientId: client.id,
    name: 'Schedule Hardening Site',
    addressLine1: '1 Reliability Street',
    city: 'Dublin',
    postalCode: 'D01 HARD',
    areas: [{ name: 'Office', type: 'zone' }],
  })).body.data
  const plan = (await request(app).post('/api/service-plans').set('Cookie', adminCookie).send({
    siteId: site.id,
    name: 'Hardening Clean',
    expectedDurationMinutes: 120,
    requiredWorkers,
    tasks: [{ areaId: site.areas[0].id, title: 'Clean office', responseType: 'done_na_problem' }],
  })).body.data
  expect((await request(app).post(`/api/service-plans/${plan.id}/publish`).set('Cookie', adminCookie)).status).toBe(201)
  return plan
}

async function createOneOff(planId: string, input?: { assigneeIds?: string[]; startAt?: string }) {
  const response = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
    servicePlanId: planId,
    name: `Hardening visit ${Date.now()}`,
    startAt: input?.startAt ?? '2026-08-24T15:00:00.000Z',
    durationMinutes: 120,
    recurrence: { frequency: 'once' },
    assigneeIds: input?.assigneeIds ?? [],
  })
  expect(response.status).toBe(201)
  return prisma.visit.findFirstOrThrow({ where: { jobId: response.body.data.id }, include: { assignments: true } })
}

describe('schedule hardening', () => {
  it('rejects manual visit assignment during recurring weekly unavailability', async () => {
    const plan = await publishedPlan()
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const profile = await prisma.workforceProfile.findUniqueOrThrow({ where: { userId: employee.id } })

    // 24 Aug 2026 is Monday. Europe/Dublin is UTC+1 in August, so this
    // 09:00Z visit falls inside the employee's 09:00–14:00 local rule.
    await prisma.recurringUnavailability.create({
      data: {
        organizationId: profile.organizationId,
        profileId: profile.id,
        dayOfWeek: 1,
        startsMinute: 9 * 60,
        endsMinute: 14 * 60,
        reason: 'Other job every Monday',
      },
    })

    const visit = await createOneOff(plan.id, { startAt: '2026-08-24T09:00:00.000Z' })
    const response = await request(app)
      .patch(`/api/visits/${visit.id}`)
      .set('Cookie', adminCookie)
      .send({ version: visit.version, assigneeIds: [employee.id] })

    expect(response.status).toBe(409)
    expect(response.body.code).toBe('ASSIGNEE_WORKFORCE_CONSTRAINT')
    expect(response.body.error).toContain('recurring unavailability')
    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: employee.id, kind: 'recurring_unavailability', reason: 'Other job every Monday' }),
    ]))
    expect(await prisma.visitAssignment.count({ where: { visitId: visit.id, userId: employee.id } })).toBe(0)
  })

  it('requires acknowledgement again after a material manager edit', async () => {
    const plan = await publishedPlan()
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const visit = await createOneOff(plan.id, { assigneeIds: [employee.id] })

    const firstAck = await request(app)
      .post(`/api/visits/${visit.id}/acknowledgement`)
      .set('Cookie', employeeCookie)
      .send({ status: 'acknowledged' })
    expect(firstAck.status).toBe(200)

    const acknowledgedVisit = await prisma.visit.findUniqueOrThrow({ where: { id: visit.id } })
    expect(acknowledgedVisit.status).toBe('acknowledged')

    const changed = await request(app)
      .patch(`/api/visits/${visit.id}`)
      .set('Cookie', adminCookie)
      .send({
        version: acknowledgedVisit.version,
        assigneeIds: [employee.id],
        dispatchNotes: 'Use the loading bay entrance tonight.',
      })
    expect(changed.status).toBe(200)

    const assignment = await prisma.visitAssignment.findFirstOrThrow({ where: { visitId: visit.id, userId: employee.id } })
    expect(assignment.status).toBe('assigned')
    expect(assignment.acknowledgedAt).toBeNull()
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: visit.id } })).status).toBe('dispatched')

    const healthAfterChange = await request(app)
      .get('/api/schedule-health?from=2026-08-24T00:00:00.000Z&to=2026-08-25T00:00:00.000Z')
      .set('Cookie', adminCookie)
    expect(healthAfterChange.status).toBe(200)
    expect(healthAfterChange.body.data.summary.unacknowledged).toBe(1)

    const secondAck = await request(app)
      .post(`/api/visits/${visit.id}/acknowledgement`)
      .set('Cookie', employeeCookie)
      .send({ status: 'acknowledged' })
    expect(secondAck.status).toBe(200)

    const healthAfterAck = await request(app)
      .get('/api/schedule-health?from=2026-08-24T00:00:00.000Z&to=2026-08-25T00:00:00.000Z')
      .set('Cookie', adminCookie)
    expect(healthAfterAck.body.data.summary.unacknowledged).toBe(0)
  })

  it('does not put completed visits back into operational schedule health', async () => {
    const plan = await publishedPlan()
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const visit = await createOneOff(plan.id, { assigneeIds: [employee.id] })

    await prisma.visit.update({ where: { id: visit.id }, data: { status: 'completed' } })

    const health = await request(app)
      .get('/api/schedule-health?from=2026-08-24T00:00:00.000Z&to=2026-08-25T00:00:00.000Z')
      .set('Cookie', adminCookie)

    expect(health.status).toBe(200)
    expect(health.body.data.summary.visits).toBe(0)
    expect(health.body.data.summary.covered).toBe(0)
    expect(health.body.data.summary.unacknowledged).toBe(0)
    expect(health.body.data.items.some((item: { visitId?: string }) => item.visitId === visit.id)).toBe(false)
  })
})
