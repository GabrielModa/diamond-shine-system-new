import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { ensureScheduleContinuity } from '../../src/modules/scheduling/continuity'
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

async function recurringPlan() {
  const client = (await request(app).post('/api/clients').set('Cookie', adminCookie).send({ displayName: 'Recurring Client' })).body.data
  const site = (await request(app).post('/api/sites').set('Cookie', adminCookie).send({
    clientId: client.id,
    name: 'Recurring Site',
    addressLine1: '1 Commitment Street',
    city: 'Dublin',
    postalCode: 'D01 TEST',
    areas: [{ name: 'Office', type: 'zone' }],
  })).body.data
  const plan = (await request(app).post('/api/service-plans').set('Cookie', adminCookie).send({
    siteId: site.id,
    name: 'Recurring clean',
    expectedDurationMinutes: 120,
    requiredWorkers: 1,
    tasks: [{ areaId: site.areas[0].id, title: 'Clean office', responseType: 'done_na_problem' }],
  })).body.data
  expect((await request(app).post(`/api/service-plans/${plan.id}/publish`).set('Cookie', adminCookie)).status).toBe(201)
  return plan
}

describe('recurring assignment commitment', () => {
  it('accepts a recurring job once, emails both sides, and carries acceptance into later generated visits', async () => {
    const plan = await recurringPlan()
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: employee.id, status: 'active' },
      select: { organizationId: true },
    })
    const created = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id,
      name: 'Mon Wed recurring clean',
      startAt: '2026-12-07T17:30:00.000Z',
      generateUntil: '2026-12-11T23:00:00.000Z',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [1, 3] },
      assigneeIds: [employee.id],
    })
    expect(created.status).toBe(201)
    const jobId = created.body.data.id as string
    const initial = await prisma.visit.findMany({
      where: { jobId },
      include: { assignments: true },
      orderBy: { scheduledStart: 'asc' },
    })
    expect(initial).toHaveLength(2)
    expect(initial.every((visit) => visit.assignments[0]?.status === 'assigned')).toBe(true)

    const employeeAssignmentEmail = await prisma.notificationJob.findFirst({
      where: {
        organizationId: membership.organizationId,
        kind: 'operational_email',
        createdBy: 'admin@ds.ie',
        entityType: 'job',
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(employeeAssignmentEmail).not.toBeNull()
    const employeeAssignmentPayload = employeeAssignmentEmail?.payload as Record<string, unknown>
    expect(employeeAssignmentPayload.title).toBe('New recurring cleaning schedule')
    expect(employeeAssignmentPayload.userIds).toEqual([employee.id])

    const accepted = await request(app)
      .post(`/api/visits/${initial[0].id}/acknowledgement`)
      .set('Cookie', employeeCookie)
      .send({ status: 'acknowledged', scope: 'recurring' })
    expect(accepted.status).toBe(200)
    expect(accepted.body.data.affectedVisits).toBe(2)

    const managerResponseEmail = await prisma.notificationJob.findFirst({
      where: {
        organizationId: membership.organizationId,
        kind: 'operational_email',
        createdBy: 'employee@ds.ie',
        entityType: 'visit_assignment',
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(managerResponseEmail).not.toBeNull()
    const managerResponsePayload = managerResponseEmail?.payload as Record<string, unknown>
    expect(managerResponsePayload.title).toBe('Cleaning schedule confirmed')
    expect(managerResponsePayload.tone).toBe('success')
    expect(Array.isArray(managerResponsePayload.userIds)).toBe(true)
    expect((managerResponsePayload.userIds as string[]).length).toBeGreaterThan(0)

    const acceptedInitial = await prisma.visit.findMany({
      where: { jobId },
      include: { assignments: true },
      orderBy: { scheduledStart: 'asc' },
    })
    expect(acceptedInitial.every((visit) => visit.status === 'acknowledged')).toBe(true)
    expect(acceptedInitial.every((visit) => visit.assignments[0]?.status === 'acknowledged')).toBe(true)

    const pending = await request(app).get('/api/mobile/work-commitments').set('Cookie', employeeCookie)
    expect(pending.status).toBe(200)
    expect(pending.body.data.filter((item: { jobId: string }) => item.jobId === jobId)).toHaveLength(0)

    await ensureScheduleContinuity({
      organizationId: membership.organizationId,
      from: new Date('2026-12-12T00:00:00.000Z'),
      to: new Date('2026-12-19T00:00:00.000Z'),
      jobIds: [jobId],
    })

    const generatedLater = await prisma.visit.findMany({
      where: { jobId, scheduledStart: { gte: new Date('2026-12-12T00:00:00.000Z') } },
      include: { assignments: true },
      orderBy: { scheduledStart: 'asc' },
    })
    expect(generatedLater).toHaveLength(2)
    expect(generatedLater.every((visit) => visit.status === 'acknowledged')).toBe(true)
    expect(generatedLater.every((visit) => visit.assignments[0]?.status === 'acknowledged')).toBe(true)
  })
})
