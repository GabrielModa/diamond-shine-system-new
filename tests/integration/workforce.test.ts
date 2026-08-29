import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { LEGACY_ORGANIZATION_ID } from '../../src/lib/tenancy'
import { getAuthCookie, seedUsers } from './setup'

let app: ReturnType<typeof createServer>
let nextApp: ReturnType<typeof next>
let adminCookie = ''
let employeeCookie = ''
let employeeId = ''
let supervisorId = ''

function dublinDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

async function resetWorkforceFixtures() {
  await prisma.workforceLeave.deleteMany()
  await prisma.studySchedule.deleteMany()
  await prisma.workforceProfile.deleteMany()
  await prisma.timeEntry.deleteMany({ where: { source: 'workforce-integration-test' } })

  const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
  const supervisor = await prisma.user.findUniqueOrThrow({ where: { email: 'super@ds.ie' } })
  employeeId = employee.id
  supervisorId = supervisor.id
  await prisma.user.update({ where: { id: employee.id }, data: { name: 'Employee' } })

  const employeeProfile = await prisma.workforceProfile.create({
    data: {
      organizationId: LEGACY_ORGANIZATION_ID,
      userId: employee.id,
      homeAddress: 'Phibsborough, Dublin 7',
      homeLatitude: 53.3597,
      homeLongitude: -6.2735,
      schoolName: 'Integration Test College',
      schoolAddress: 'Dublin 2',
      schoolLatitude: 53.3434,
      schoolLongitude: -6.2672,
      weeklyTargetMinutes: 1800,
      weeklyTargetConfigured: true,
      travelMode: 'transit',
    },
  })

  await prisma.studySchedule.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
      organizationId: LEGACY_ORGANIZATION_ID,
      profileId: employeeProfile.id,
      dayOfWeek,
      startsMinute: 0,
      endsMinute: 1440,
    })),
  })

  const supervisorProfile = await prisma.workforceProfile.create({
    data: {
      organizationId: LEGACY_ORGANIZATION_ID,
      userId: supervisor.id,
      homeAddress: 'Tallaght, Dublin 24',
      homeLatitude: 53.2878,
      homeLongitude: -6.3411,
      weeklyTargetMinutes: 1800,
      weeklyTargetConfigured: true,
      travelMode: 'driving',
    },
  })

  const now = new Date()
  await prisma.workforceLeave.create({
    data: {
      organizationId: LEGACY_ORGANIZATION_ID,
      profileId: supervisorProfile.id,
      kind: 'personal_leave',
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 86_400_000),
      reason: 'Integration leave',
    },
  })

  const fixtureDate = dublinDateKey()
  const startedAt = new Date(`${fixtureDate}T12:00:00.000Z`)
  await prisma.timeEntry.create({
    data: {
      organizationId: LEGACY_ORGANIZATION_ID,
      userId: employee.id,
      kind: 'general',
      status: 'approved',
      startedAt,
      endedAt: new Date(startedAt.getTime() + 5 * 3_600_000),
      durationSeconds: 5 * 3600,
      source: 'workforce-integration-test',
      clientMutationId: `workforce-integration-${Date.now()}`,
    },
  })
}

beforeAll(async () => {
  process.env.GEOCODING_TEST_MODE = '1'
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
  await resetWorkforceFixtures()
})

describe('GET /api/workforce', () => {
  it('requires manager authentication', async () => {
    expect((await request(app).get('/api/workforce')).status).toBe(401)
  })

  it('returns worked/planned/target/capacity and daily breakdown for a custom period', async () => {
    const today = dublinDateKey()
    const response = await request(app)
      .get(`/api/workforce?from=${today}&to=${today}`)
      .set('Cookie', adminCookie)

    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    expect(response.body.data.period.preset).toBe('custom')

    const employee = response.body.data.employees.find((item: { id: string }) => item.id === employeeId)
    expect(employee).toBeTruthy()
    expect(employee.actualMinutes).toBe(300)
    expect(employee.periodTargetMinutes).toBeGreaterThan(0)
    expect(employee.remainingCapacityMinutes).toBeGreaterThanOrEqual(0)
    expect(employee.dailyBreakdown).toHaveLength(1)
    expect(employee.dailyBreakdown[0].actualMinutes).toBe(300)
  })

  it('uses school as current origin when the study window is active', async () => {
    const response = await request(app).get('/api/workforce?range=week').set('Cookie', adminCookie)
    const employee = response.body.data.employees.find((item: { id: string }) => item.id === employeeId)

    expect(employee.context.state).toBe('school')
    expect(employee.context.origin.kind).toBe('school')
    expect(employee.context.origin.label).toBe('Integration Test College')
    expect(employee.context.availableForScheduling).toBe(false)
  })

  it('marks personal leave as unavailable so it can be excluded from the operational map', async () => {
    const response = await request(app).get('/api/workforce?range=week').set('Cookie', adminCookie)
    const supervisor = response.body.data.employees.find((item: { id: string }) => item.id === supervisorId)

    expect(supervisor.context.state).toBe('personal_leave')
    expect(supervisor.context.availableForScheduling).toBe(false)
    expect(supervisor.context.origin).toBeNull()
  })


  it('never invents a home or school location when profile setup is missing', async () => {
    await prisma.workforceProfile.delete({ where: { userId: employeeId } })
    const response = await request(app).get('/api/workforce?range=week').set('Cookie', adminCookie)
    const employee = response.body.data.employees.find((item: { id: string }) => item.id === employeeId)
    expect(employee.profile.setupRequired).toBe(true)
    expect(employee.profile.home.address).toBe('Not configured')
    expect(employee.profile.school).toBeNull()
    expect(employee.context.availableForScheduling).toBe(false)
    expect(employee.context.origin).toBeNull()
  })

  it('lets employees own personal, home and study details while preserving employment settings', async () => {
    const before = await prisma.workforceProfile.findUniqueOrThrow({ where: { userId: employeeId } })
    const response = await request(app)
      .put('/api/workforce/profile')
      .set('Cookie', employeeCookie)
      .send({
        phone: '+353871234567',
        home: { address: 'New operational base, Dublin' },
        travelMode: 'cycling',
        emergencyContact: { name: 'Emergency Person', phone: '+353879876543' },
        school: { name: 'Employee College', address: 'College Road, Dublin' },
        studySchedule: [{ dayOfWeek: 1, startsMinute: 540, endsMinute: 720 }],
        recurringUnavailability: [{ dayOfWeek: 3, startsMinute: 1080, endsMinute: 1320, reason: 'Other job' }],
      })

    expect(response.status).toBe(200)
    expect(response.body.data.managerSetupRequired).toBe(false)
    expect(await prisma.notificationJob.count({
      where: { kind: 'profile_change_alert', entityType: 'workforce_profile', entityId: employeeId },
    })).toBeGreaterThan(0)
    const saved = await prisma.workforceProfile.findUniqueOrThrow({ where: { userId: employeeId } })
    expect(saved.phone).toBe('+353871234567')
    expect(saved.homeAddress).toBe('New operational base, Dublin')
    expect(saved.homeLatitude).not.toBeNull()
    expect(saved.homeLongitude).not.toBeNull()
    expect(saved.travelMode).toBe('cycling')
    expect(saved.emergencyContactName).toBe('Emergency Person')
    expect(saved.schoolName).toBe('Employee College')
    expect(saved.schoolAddress).toBe('Employee College, College Road, Dublin')
    expect(saved.schoolLatitude).not.toBeNull()
    expect(saved.schoolLongitude).not.toBeNull()
    expect(saved.weeklyTargetMinutes).toBe(before.weeklyTargetMinutes)
    expect(saved.weeklyTargetConfigured).toBe(true)
    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: employeeId } })
    expect(updatedUser.name).toBe('Employee')
    const studyRules = await prisma.studySchedule.findMany({ where: { profileId: saved.id } })
    expect(studyRules).toHaveLength(1)
    expect(studyRules[0]).toMatchObject({ dayOfWeek: 1, startsMinute: 540, endsMinute: 720 })
    const recurringRules = await prisma.recurringUnavailability.findMany({ where: { profileId: saved.id } })
    expect(recurringRules).toHaveLength(1)
    expect(recurringRules[0]).toMatchObject({ dayOfWeek: 3, startsMinute: 1080, endsMinute: 1320, reason: 'Other job' })

    const forbidden = await request(app)
      .put(`/api/workforce/profiles/${employeeId}`)
      .set('Cookie', employeeCookie)
      .send({ weeklyTargetMinutes: 600, employmentStartDate: null })
    expect(forbidden.status).toBe(403)

    const hiddenEmployment = await request(app)
      .get(`/api/workforce/profiles/${employeeId}`)
      .set('Cookie', employeeCookie)
    expect(hiddenEmployment.status).toBe(403)
  })

  it('rejects employee attempts to overpost company-managed identity fields', async () => {
    const response = await request(app)
      .put('/api/workforce/profile')
      .set('Cookie', employeeCookie)
      .send({
        name: 'Employee Updated',
        phone: '+353871234567',
        home: { address: 'New operational base, Dublin' },
        travelMode: 'cycling',
        emergencyContact: null,
        school: null,
        studySchedule: [],
        recurringUnavailability: [],
      })

    expect(response.status).toBe(400)
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: employeeId } })
    expect(unchanged.name).toBe('Employee')
  })

  it('employment settings change only company-owned fields', async () => {
    const before = await prisma.workforceProfile.findUniqueOrThrow({ where: { userId: employeeId } })
    const response = await request(app)
      .put(`/api/workforce/profiles/${employeeId}`)
      .set('Cookie', adminCookie)
      .send({ weeklyTargetMinutes: 2100, employmentStartDate: '2026-08-01' })

    expect(response.status).toBe(200)
    const saved = await prisma.workforceProfile.findUniqueOrThrow({ where: { userId: employeeId } })
    expect(saved.weeklyTargetMinutes).toBe(2100)
    expect(saved.weeklyTargetConfigured).toBe(true)
    expect(saved.employmentStartDate?.toISOString().slice(0, 10)).toBe('2026-08-01')
    expect(saved.homeAddress).toBe(before.homeAddress)
    expect(saved.schoolAddress).toBe(before.schoolAddress)
    expect(saved.travelMode).toBe(before.travelMode)
    expect(saved.phone).toBe(before.phone)
  })

  it('keeps employee identity admin-only after invitation', async () => {
    const forbidden = await request(app)
      .patch(`/api/users/${employeeId}/identity`)
      .set('Cookie', employeeCookie)
      .send({ name: 'Employee Self Rename', email: 'self-rename@ds.ie' })
    expect(forbidden.status).toBe(403)

    const updated = await request(app)
      .patch(`/api/users/${employeeId}/identity`)
      .set('Cookie', adminCookie)
      .send({ name: 'Employee Admin Updated', email: 'employee-updated@ds.ie' })
    expect(updated.status).toBe(200)
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: employeeId } })
    expect(saved.name).toBe('Employee Admin Updated')
    expect(saved.email).toBe('employee-updated@ds.ie')

    await prisma.user.update({ where: { id: employeeId }, data: { name: 'Employee', email: 'employee@ds.ie' } })
  })

  it('returns quality signals used by manager filters and map context', async () => {
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    await prisma.feedbackEntry.deleteMany({ where: { employeeId: employee.id } })
    await prisma.feedbackEntry.createMany({
      data: [
        { organizationId: LEGACY_ORGANIZATION_ID, employeeId: employee.id, employeeName: 'Strikerlift', clientLocation: 'Test Site', cleanliness: 5, punctuality: 4.5, equipment: 4.5, clientRelations: 5, overall: 4.8, category: 'Excellent', submittedBy: 'admin@ds.ie' },
        { organizationId: LEGACY_ORGANIZATION_ID, employeeId: employee.id, employeeName: 'Strikerlift', clientLocation: 'Test Site', cleanliness: 4.5, punctuality: 4.5, equipment: 4, clientRelations: 4.5, overall: 4.4, category: 'Good', submittedBy: 'admin@ds.ie' },
      ],
    })
    const response = await request(app).get('/api/workforce?range=week').set('Cookie', adminCookie)
    const row = response.body.data.employees.find((item: { id: string }) => item.id === employee.id)
    expect(row.qualityAverage).toBe(4.6)
    expect(row.qualityCount).toBe(2)
    expect(row.qualityBand).toBe('excellent')
    expect(row.qualityBreakdown.cleanliness).toBe(4.8)
  })


  it('rejects an inverted custom date range', async () => {
    const response = await request(app)
      .get('/api/workforce?from=2026-08-25&to=2026-08-20')
      .set('Cookie', adminCookie)

    expect(response.status).toBe(400)
    expect(response.body.ok).toBe(false)
  })
})


afterAll(async () => {
  await nextApp.close()
})
