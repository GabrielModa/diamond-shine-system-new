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
let viewerCookie: string

beforeAll(async () => {
  process.env.NEXT_TEST_DIST_DIR = '.next-integration'
  nextApp = next({ dev: true, dir: process.cwd() })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()
  app = createServer((req, res) => handle(req, res, parse(req.url!, true)))
  await seedUsers()
  adminCookie = await getAuthCookie('admin@ds.ie')
  employeeCookie = await getAuthCookie('employee@ds.ie')
  viewerCookie = await getAuthCookie('viewer@ds.ie')
})

beforeEach(async () => {
  await prisma.workforceLeave.deleteMany()
  await prisma.studySchedule.deleteMany()
  await prisma.workforceProfile.deleteMany()
  await cleanOperations()
  const roleByEmail = { 'admin@ds.ie': 'organization_admin', 'super@ds.ie': 'field_supervisor', 'employee@ds.ie': 'employee', 'viewer@ds.ie': 'viewer' } as const
  for (const [email, role] of Object.entries(roleByEmail)) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    await prisma.membership.updateMany({ where: { userId: user.id, organizationId: 'org_legacy_diamond_shine' }, data: { role } })
  }
})

afterAll(async () => {
  await prisma.workforceLeave.deleteMany()
  await prisma.studySchedule.deleteMany()
  await prisma.workforceProfile.deleteMany()
  await cleanOperations()
  await nextApp.close()
})

async function publishedPlan(label: string) {
  const client = (await request(app).post('/api/clients').set('Cookie', adminCookie).send({ displayName: `${label} Client` })).body.data
  const site = (await request(app).post('/api/sites').set('Cookie', adminCookie).send({
    clientId: client.id,
    name: `${label} Site`,
    addressLine1: '1 Integrity Street',
    city: 'Dublin',
    postalCode: 'D01 TEST',
    timezone: 'Europe/Dublin',
    areas: [{ name: 'Office', type: 'zone' }],
  })).body.data
  const plan = (await request(app).post('/api/service-plans').set('Cookie', adminCookie).send({
    siteId: site.id,
    name: `${label} Clean`,
    expectedDurationMinutes: 60,
    requiredWorkers: 1,
    tasks: [{ areaId: site.areas[0].id, title: 'Clean office', responseType: 'done_na_problem' }],
  })).body.data
  expect((await request(app).post(`/api/service-plans/${plan.id}/publish`).set('Cookie', adminCookie)).status).toBe(201)
  return plan
}

describe('system integrity — scheduling lifecycle', () => {
  it('cancellation leaves operational views, preserves assignment history and notifies the cleaner', async () => {
    const plan = await publishedPlan('Cancellation')
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const created = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id,
      name: 'Integrity cancellation visit',
      startAt: '2026-08-26T09:00:00.000Z',
      timezone: 'Europe/Dublin',
      recurrence: { frequency: 'once' },
      assigneeIds: [employee.id],
    })
    expect(created.status).toBe(201)
    const visit = await prisma.visit.findFirstOrThrow({ where: { jobId: created.body.data.id }, include: { assignments: true } })
    const assignmentId = visit.assignments[0].id

    const acknowledged = await request(app).post(`/api/visits/${visit.id}/acknowledgement`).set('Cookie', employeeCookie).send({ status: 'acknowledged' })
    expect(acknowledged.status).toBe(200)

    const cancelled = await request(app).patch(`/api/visits/${visit.id}`).set('Cookie', adminCookie).send({
      version: visit.version,
      status: 'cancelled',
      cancellationReason: 'Client building closed',
      assigneeIds: [employee.id],
    })
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.data.status).toBe('cancelled')

    const savedAssignment = await prisma.visitAssignment.findUniqueOrThrow({ where: { id: assignmentId } })
    expect(savedAssignment.status).toBe('acknowledged')
    expect(savedAssignment.acknowledgedAt).toBeTruthy()

    const operational = await request(app).get('/api/visits?from=2026-08-25&to=2026-08-27').set('Cookie', adminCookie)
    expect(operational.status).toBe(200)
    expect(operational.body.data.some((item: { id: string }) => item.id === visit.id)).toBe(false)

    const history = await request(app).get('/api/visits?mode=history&from=2026-08-25&to=2026-08-27').set('Cookie', adminCookie)
    expect(history.status).toBe(200)
    expect(history.body.data.find((item: { id: string }) => item.id === visit.id)?.cancellationReason).toBe('Client building closed')

    const notice = await prisma.operationalNotice.findFirst({ where: { visitId: visit.id, title: 'Cleaning visit cancelled' }, include: { recipients: true } })
    expect(notice?.recipients.some((recipient) => recipient.userId === employee.id)).toBe(true)

    const employeeList = await request(app).get('/api/visits?from=2026-08-25&to=2026-08-27').set('Cookie', employeeCookie)
    expect(employeeList.body.data).toHaveLength(0)
  })

  it('decline releases execution access, overlap and coverage while retaining the decline', async () => {
    const plan = await publishedPlan('Decline')
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const first = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id,
      name: 'Declinable work',
      startAt: '2026-08-26T08:00:00.000Z',
      durationMinutes: 120,
      timezone: 'Europe/Dublin',
      recurrence: { frequency: 'once' },
      assigneeIds: [employee.id],
    })
    expect(first.status).toBe(201)
    const visit = await prisma.visit.findFirstOrThrow({ where: { jobId: first.body.data.id } })

    const declined = await request(app).post(`/api/visits/${visit.id}/acknowledgement`).set('Cookie', employeeCookie).send({
      status: 'declined',
      reason: 'Cannot reach the site at this time',
    })
    expect(declined.status).toBe(200)
    expect(declined.body.data.status).toBe('declined')

    const employeeList = await request(app).get('/api/visits?from=2026-08-25&to=2026-08-27').set('Cookie', employeeCookie)
    expect(employeeList.body.data).toHaveLength(0)

    const replacement = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id,
      name: 'Replacement work after decline',
      startAt: '2026-08-26T09:00:00.000Z',
      durationMinutes: 60,
      timezone: 'Europe/Dublin',
      recurrence: { frequency: 'once' },
      assigneeIds: [employee.id],
    })
    expect(replacement.status).toBe(201)

    const jobs = await request(app).get('/api/jobs').set('Cookie', adminCookie)
    const original = jobs.body.data.find((job: { id: string }) => job.id === first.body.data.id)
    expect(original.coverageGaps).toBe(1)

    const field = await request(app).get('/api/field-control?from=2026-08-26&to=2026-08-27').set('Cookie', adminCookie)
    expect(field.status).toBe(200)
    const originalFieldVisit = field.body.data.visits.find((item: { id: string }) => item.id === visit.id)
    expect(originalFieldVisit.assignments).toHaveLength(0)
  })

  it('school blocks work, school holiday removes that block, and personal leave remains unavailable', async () => {
    const plan = await publishedPlan('School')
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const profile = await prisma.workforceProfile.create({
      data: {
        organizationId: 'org_legacy_diamond_shine',
        userId: employee.id,
        homeAddress: 'Dublin', homeLatitude: 53.34, homeLongitude: -6.26,
        schoolName: 'Integrity College', schoolAddress: 'Dublin 2', schoolLatitude: 53.34, schoolLongitude: -6.25,
        weeklyTargetMinutes: 1800, travelMode: 'transit',
      },
    })
    await prisma.studySchedule.create({
      data: { organizationId: 'org_legacy_diamond_shine', profileId: profile.id, dayOfWeek: 1, startsMinute: 9 * 60, endsMinute: 14 * 60 },
    })

    const schoolBlocked = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id,
      name: 'School conflict',
      startAt: '2026-08-24T09:00:00.000Z',
      durationMinutes: 60,
      timezone: 'Europe/Dublin',
      recurrence: { frequency: 'once' },
      assigneeIds: [employee.id],
    })
    expect(schoolBlocked.status).toBe(409)
    expect(schoolBlocked.body.code).toBe('ASSIGNEE_WORKFORCE_CONSTRAINT')

    await prisma.workforceLeave.create({
      data: {
        organizationId: 'org_legacy_diamond_shine', profileId: profile.id, kind: 'school_holiday',
        startsAt: new Date('2026-08-24T00:00:00.000Z'), endsAt: new Date('2026-08-25T00:00:00.000Z'), reason: 'College closed',
      },
    })
    const holidayAllows = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id,
      name: 'School holiday work',
      startAt: '2026-08-24T09:00:00.000Z',
      durationMinutes: 60,
      timezone: 'Europe/Dublin',
      recurrence: { frequency: 'once' },
      assigneeIds: [employee.id],
    })
    expect(holidayAllows.status).toBe(201)

    await prisma.workforceLeave.create({
      data: {
        organizationId: 'org_legacy_diamond_shine', profileId: profile.id, kind: 'personal_leave',
        startsAt: new Date('2026-08-25T00:00:00.000Z'), endsAt: new Date('2026-08-27T00:00:00.000Z'), reason: 'Personal holiday',
      },
    })
    const leaveBlocked = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id,
      name: 'Personal leave conflict',
      startAt: '2026-08-26T09:00:00.000Z',
      durationMinutes: 60,
      timezone: 'Europe/Dublin',
      recurrence: { frequency: 'once' },
      assigneeIds: [employee.id],
    })
    expect(leaveBlocked.status).toBe(409)
    expect(leaveBlocked.body.data[0].kind).toBe('personal_leave')
  })

  it('scheduler can plan but cannot be assigned as an executable cleaner', async () => {
    const plan = await publishedPlan('Role')
    const viewer = await prisma.user.findUniqueOrThrow({ where: { email: 'viewer@ds.ie' } })
    await prisma.membership.updateMany({ where: { userId: viewer.id, organizationId: 'org_legacy_diamond_shine' }, data: { role: 'scheduler' } })
    const response = await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
      servicePlanId: plan.id,
      name: 'Scheduler is not a cleaner',
      startAt: '2026-08-26T09:00:00.000Z',
      timezone: 'Europe/Dublin',
      recurrence: { frequency: 'once' },
      assigneeIds: [viewer.id],
    })
    expect(response.status).toBe(400)
    expect(response.body.code).toBe('ASSIGNEE_NOT_EXECUTABLE')
  })
})

describe('system integrity — capability based supplies', () => {
  it('stock controller manages supplies through capabilities rather than legacy role', async () => {
    const viewer = await prisma.user.findUniqueOrThrow({ where: { email: 'viewer@ds.ie' } })
    await prisma.membership.updateMany({ where: { userId: viewer.id, organizationId: 'org_legacy_diamond_shine' }, data: { role: 'stock_controller' } })
    const list = await request(app).get('/api/supplies').set('Cookie', viewerCookie)
    expect(list.status).toBe(200)
    const control = await request(app).get('/api/materials/control').set('Cookie', viewerCookie)
    expect(control.status).toBe(200)
  })
})
