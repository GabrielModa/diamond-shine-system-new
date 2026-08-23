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

async function publishedPlan() {
  const client = (await request(app).post('/api/clients').set('Cookie', adminCookie).send({ displayName: 'Schedule Client' })).body.data
  const site = (await request(app).post('/api/sites').set('Cookie', adminCookie).send({
    clientId: client.id, name: 'Schedule Site', addressLine1: '1 Route Street', city: 'Dublin', postalCode: 'D01 ROUTE', areas: [{ name: 'Office', type: 'zone' }],
  })).body.data
  const plan = (await request(app).post('/api/service-plans').set('Cookie', adminCookie).send({
    siteId: site.id, name: 'Weekday Clean', expectedDurationMinutes: 120, requiredWorkers: 1,
    tasks: [{ areaId: site.areas[0].id, title: 'Clean office', responseType: 'done_na_problem' }],
  })).body.data
  expect((await request(app).post(`/api/service-plans/${plan.id}/publish`).set('Cookie', adminCookie)).status).toBe(201)
  return plan
}

describe('jobs and visits', () => {
  it('generates recurring visits from an immutable plan version', async () => {
    const plan = await publishedPlan()
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const response = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id, name: 'Mon Wed cleaning', startAt: '2026-08-24T08:00:00.000Z', generateUntil: '2026-09-06T23:00:00.000Z',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [1, 3] }, assigneeIds: [employee.id],
    })
    expect(response.status).toBe(201)
    expect(response.body.data.generatedVisits).toBe(4)
    const visits = await prisma.visit.findMany({ where: { jobId: response.body.data.id }, include: { assignments: true }, orderBy: { scheduledStart: 'asc' } })
    expect(visits.map((visit) => visit.scheduledStart.getUTCDay())).toEqual([1, 3, 1, 3])
    expect(new Set(visits.map((visit) => visit.servicePlanVersionId)).size).toBe(1)
    expect(visits.every((visit) => visit.assignments[0]?.userId === employee.id)).toBe(true)
  })

  it('shows employees only their assigned visits and records acknowledgement', async () => {
    const plan = await publishedPlan()
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const created = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({ servicePlanId: plan.id, name: 'Assigned visit', startAt: '2026-08-24T08:00:00.000Z', recurrence: { frequency: 'once' }, assigneeIds: [employee.id] })
    const visit = await prisma.visit.findFirstOrThrow({ where: { jobId: created.body.data.id } })
    const list = await request(app).get('/api/visits?from=2026-08-23&to=2026-08-25').set('Cookie', employeeCookie)
    expect(list.status).toBe(200); expect(list.body.data).toHaveLength(1)
    const acknowledged = await request(app).post(`/api/visits/${visit.id}/acknowledgement`).set('Cookie', employeeCookie).send({ status: 'acknowledged' })
    expect(acknowledged.status).toBe(200)
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: visit.id } })).status).toBe('acknowledged')
  })

  it('rejects overlapping assignments and stale schedule edits', async () => {
    const plan = await publishedPlan()
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const first = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({ servicePlanId: plan.id, name: 'First', startAt: '2026-08-24T08:00:00.000Z', durationMinutes: 120, recurrence: { frequency: 'once' }, assigneeIds: [employee.id] })
    const duplicateAssignment = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({ servicePlanId: plan.id, name: 'Double booked', startAt: '2026-08-24T09:00:00.000Z', durationMinutes: 60, recurrence: { frequency: 'once' }, assigneeIds: [employee.id] })
    expect(duplicateAssignment.status).toBe(409); expect(duplicateAssignment.body.code).toBe('ASSIGNEE_OVERLAP')
    const second = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({ servicePlanId: plan.id, name: 'Second', startAt: '2026-08-24T13:00:00.000Z', durationMinutes: 60, recurrence: { frequency: 'once' } })
    const firstVisit = await prisma.visit.findFirstOrThrow({ where: { jobId: first.body.data.id } })
    const secondVisit = await prisma.visit.findFirstOrThrow({ where: { jobId: second.body.data.id } })
    const conflict = await request(app).patch(`/api/visits/${secondVisit.id}`).set('Cookie', adminCookie).send({ version: secondVisit.version, scheduledStart: '2026-08-24T09:00:00.000Z', scheduledEnd: '2026-08-24T10:00:00.000Z', assigneeIds: [employee.id] })
    expect(conflict.status).toBe(409); expect(conflict.body.code).toBe('ASSIGNEE_OVERLAP')
    const valid = await request(app).patch(`/api/visits/${secondVisit.id}`).set('Cookie', adminCookie).send({ version: secondVisit.version, scheduledStart: '2026-08-24T11:00:00.000Z', scheduledEnd: '2026-08-24T12:00:00.000Z', assigneeIds: [employee.id] })
    expect(valid.status).toBe(200)
    const notice = await prisma.operationalNotice.findFirstOrThrow({ where: { visitId: secondVisit.id }, include: { recipients: true } })
    expect(notice.requiresAcknowledgement).toBe(true)
    expect(notice.recipients.map((recipient) => recipient.userId)).toEqual([employee.id])
    const stale = await request(app).patch(`/api/visits/${secondVisit.id}`).set('Cookie', adminCookie).send({ version: secondVisit.version, dispatchNotes: 'stale' })
    expect(stale.status).toBe(409)
    expect(firstVisit.scheduledStart.toISOString()).toBe('2026-08-24T08:00:00.000Z')
  })

  it('turns employee unavailability into a schedule guard instead of a message', async () => {
    const plan = await publishedPlan()
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const declared = await request(app).post('/api/availability').set('Cookie', employeeCookie).send({
      startsAt: '2026-08-24T08:00:00.000Z', endsAt: '2026-08-24T12:00:00.000Z', reason: 'Medical appointment',
    })
    expect(declared.status).toBe(201)
    const ownAvailability = await request(app).get('/api/availability').set('Cookie', employeeCookie)
    expect(ownAvailability.status).toBe(200); expect(ownAvailability.body.data).toHaveLength(1)
    const blocked = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id, name: 'Unavailable worker', startAt: '2026-08-24T09:00:00.000Z', durationMinutes: 120, recurrence: { frequency: 'once' }, assigneeIds: [employee.id],
    })
    expect(blocked.status).toBe(409); expect(blocked.body.code).toBe('ASSIGNEE_UNAVAILABLE')
    const cancelled = await request(app).delete(`/api/availability/${declared.body.data.id}`).set('Cookie', employeeCookie)
    expect(cancelled.status).toBe(200)
    const scheduled = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id, name: 'Available again', startAt: '2026-08-24T09:00:00.000Z', durationMinutes: 120, recurrence: { frequency: 'once' }, assigneeIds: [employee.id],
    })
    expect(scheduled.status).toBe(201)
  })
})
