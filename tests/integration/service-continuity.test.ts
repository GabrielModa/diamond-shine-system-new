import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { cleanOperations, getAuthCookie, seedUsers } from './setup'

let app: ReturnType<typeof createServer>
let nextApp: ReturnType<typeof next>
let adminCookie: string
let employeeCookie: string

beforeAll(async () => {
  process.env.NEXT_TEST_DIST_DIR = '.next-integration'
  nextApp = next({ dev: true, dir: process.cwd() })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()
  app = createServer((req, res) => handle(req, res, parse(req.url!, true)))
  await cleanOperations(); await seedUsers()
  adminCookie = await getAuthCookie('admin@ds.ie')
  employeeCookie = await getAuthCookie('employee@ds.ie')
})
beforeEach(() => cleanOperations())
afterAll(async () => { await cleanOperations(); await nextApp.close() })

async function publishedPlan(name = 'Continuity Client') {
  const client = (await request(app).post('/api/clients').set('Cookie', adminCookie).send({ displayName: name })).body.data
  const site = (await request(app).post('/api/sites').set('Cookie', adminCookie).send({
    clientId: client.id, name: 'Main Office', addressLine1: '10 Continuity Road', city: 'Dublin', postalCode: 'D01 CONT', areas: [{ name: 'Office', type: 'zone' }],
  })).body.data
  const plan = (await request(app).post('/api/service-plans').set('Cookie', adminCookie).send({
    siteId: site.id, name: 'Office Cleaning', expectedDurationMinutes: 120, requiredWorkers: 1,
    tasks: [{ areaId: site.areas[0].id, title: 'Clean office', responseType: 'done_na_problem' }],
  })).body.data
  expect((await request(app).post(`/api/service-plans/${plan.id}/publish`).set('Cookie', adminCookie)).status).toBe(201)
  return { client, site, plan }
}

describe('schedule intelligence and service continuity', () => {
  it('reports a published service plan with no schedule as an unscheduled service', async () => {
    await publishedPlan()
    const response = await request(app).get('/api/schedule-health?from=2030-09-01T00:00:00.000Z&to=2030-10-01T00:00:00.000Z').set('Cookie', adminCookie)
    expect(response.status).toBe(200)
    expect(response.body.data.summary.unscheduledServices).toBe(1)
    expect(response.body.data.summary.attention).toBe(1)
    expect(response.body.data.items.some((item: { state: string }) => item.state === 'unscheduled_service')).toBe(true)
  })

  it('extends a recurring obligation without dropping visits when the default cleaner is unavailable', async () => {
    const { plan } = await publishedPlan()
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const created = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id,
      name: 'Monday Wednesday service',
      startAt: '2030-09-02T08:00:00.000Z',
      generateUntil: '2030-09-08T23:00:00.000Z',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [1, 3] },
      assigneeIds: [employee.id],
    })
    expect(created.status).toBe(201)
    expect(await prisma.jobDefaultAssignee.count({ where: { jobId: created.body.data.id, userId: employee.id } })).toBe(1)

    await request(app).post('/api/availability').set('Cookie', employeeCookie).send({
      startsAt: '2030-09-11T07:00:00.000Z', endsAt: '2030-09-11T12:00:00.000Z', reason: 'Medical appointment',
    })

    const before = await request(app).get('/api/schedule-health?from=2030-09-09T00:00:00.000Z&to=2030-09-16T00:00:00.000Z').set('Cookie', adminCookie)
    expect(before.status).toBe(200)
    expect(before.body.data.summary.missingSchedule).toBe(2)

    const repaired = await request(app).post('/api/schedule-health').set('Cookie', adminCookie).send({
      from: '2030-09-09T00:00:00.000Z', to: '2030-09-16T00:00:00.000Z', jobIds: [created.body.data.id],
    })
    expect(repaired.status).toBe(200)
    expect(repaired.body.data.result.generatedVisits).toBe(2)
    expect(repaired.body.data.result.staffingGaps).toBe(1)

    const future = await prisma.visit.findMany({
      where: { jobId: created.body.data.id, scheduledStart: { gte: new Date('2030-09-09T00:00:00.000Z'), lt: new Date('2030-09-16T00:00:00.000Z') } },
      include: { assignments: true }, orderBy: { scheduledStart: 'asc' },
    })
    expect(future).toHaveLength(2)
    expect(future.map((visit) => visit.assignments.length).sort()).toEqual([0, 1])

    const after = await request(app).get('/api/schedule-health?from=2030-09-09T00:00:00.000Z&to=2030-09-16T00:00:00.000Z').set('Cookie', adminCookie)
    expect(after.body.data.summary.missingSchedule).toBe(0)
    expect(after.body.data.summary.unassigned).toBe(1)
  })

  it('keeps the contractual service end separate from the rolling generation horizon', async () => {
    const { plan } = await publishedPlan('Long Contract Client')
    const created = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id,
      name: 'Long running daily service',
      startAt: '2030-01-01T08:00:00.000Z',
      endDate: '2031-01-01T23:59:59.000Z',
      recurrence: { frequency: 'daily', interval: 1 },
    })
    expect(created.status).toBe(201)
    expect(created.body.data.generatedVisits).toBeLessThanOrEqual(91)
    const job = await prisma.job.findUniqueOrThrow({ where: { id: created.body.data.id } })
    expect(job.endDate?.toISOString()).toBe('2031-01-01T23:59:59.000Z')
    expect(job.generatedThrough).not.toBeNull()
    expect(job.generatedThrough!.getTime()).toBeLessThan(job.endDate!.getTime())
  })

  it('previews a bounded service pause, preserves cancellation history and makes early resume explicit', async () => {
    const { plan } = await publishedPlan('Pause Client')
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const created = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id,
      name: 'Three day service',
      startAt: '2030-09-02T08:00:00.000Z',
      generateUntil: '2030-09-30T23:00:00.000Z',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [1, 3, 5] },
      assigneeIds: [employee.id],
    })
    expect(created.status).toBe(201)

    const body = { scope: 'job', targetId: created.body.data.id, fromDate: '2030-09-09', untilDate: '2030-09-13', reason: 'Client holiday', note: 'No cleaning while the office is closed.' }
    const preview = await request(app).post('/api/service-pauses?preview=true').set('Cookie', adminCookie).send(body)
    expect(preview.status).toBe(200)
    expect(preview.body.data.consequence.canApply).toBe(true)
    expect(preview.body.data.consequence.affectedVisits).toBe(3)
    expect(preview.body.data.consequence.assignedCleaners).toBe(1)

    const applied = await request(app).post('/api/service-pauses').set('Cookie', adminCookie).send(body)
    expect(applied.status).toBe(201)
    const pause = applied.body.data.pause
    expect(await prisma.visit.count({ where: { jobId: created.body.data.id, servicePauseId: pause.id, status: 'cancelled' } })).toBe(3)

    const health = await request(app).get('/api/schedule-health?from=2030-09-09T00:00:00.000Z&to=2030-09-16T00:00:00.000Z').set('Cookie', adminCookie)
    expect(health.status).toBe(200)
    expect(health.body.data.summary.paused).toBe(3)
    expect(health.body.data.summary.missingSchedule).toBe(0)

    const ended = await request(app).patch(`/api/service-pauses/${pause.id}`).set('Cookie', adminCookie).send({ version: pause.version })
    expect(ended.status).toBe(200)
    expect(ended.body.data.affectedFutureVisits).toBe(3)
    expect(await prisma.visit.count({ where: { servicePauseId: pause.id, status: 'cancelled' } })).toBe(3)

    const resumedHealth = await request(app).get('/api/schedule-health?from=2030-09-09T00:00:00.000Z&to=2030-09-16T00:00:00.000Z').set('Cookie', adminCookie)
    expect(resumedHealth.body.data.summary.missingSchedule).toBe(3)
    expect(resumedHealth.body.data.items.filter((item: { state: string; visitId?: string }) => item.state === 'expected_not_scheduled' && item.visitId).length).toBe(3)
  })
})
