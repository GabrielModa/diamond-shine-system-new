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
  await prisma.studySchedule.deleteMany()
  await prisma.workforceLeave.deleteMany()
  await nextApp.close()
})

describe('schedule capacity availability', () => {
  it('returns server-derived workforce blockers to managers without turning them into employee availability records', async () => {
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const profile = await prisma.workforceProfile.findUniqueOrThrow({ where: { userId: employee.id } })

    await prisma.studySchedule.create({
      data: {
        organizationId: profile.organizationId,
        profileId: profile.id,
        dayOfWeek: 1,
        startsMinute: 9 * 60,
        endsMinute: 12 * 60,
      },
    })
    await prisma.recurringUnavailability.create({
      data: {
        organizationId: profile.organizationId,
        profileId: profile.id,
        dayOfWeek: 1,
        startsMinute: 18 * 60,
        endsMinute: 22 * 60,
        reason: 'Other job',
      },
    })
    await prisma.workforceLeave.create({
      data: {
        organizationId: profile.organizationId,
        profileId: profile.id,
        kind: 'personal_leave',
        startsAt: new Date('2026-08-24T13:00:00.000Z'),
        endsAt: new Date('2026-08-24T14:00:00.000Z'),
        reason: 'Appointment',
      },
    })

    const manager = await request(app)
      .get('/api/availability?from=2026-08-24T00:00:00.000Z&to=2026-08-25T00:00:00.000Z')
      .set('Cookie', adminCookie)

    expect(manager.status).toBe(200)
    const derived = manager.body.data.filter((item: { source?: string; userId: string }) =>
      item.source === 'workforce_constraint' && item.userId === employee.id)
    expect(derived.map((item: { constraintKind: string }) => item.constraintKind)).toEqual(
      expect.arrayContaining(['school', 'recurring_unavailability', 'personal_leave']),
    )
    expect(derived.some((item: { reason?: string }) => item.reason === 'Other job')).toBe(true)
    expect(derived.some((item: { reason?: string }) => item.reason === 'Appointment')).toBe(true)

    const employeeView = await request(app)
      .get('/api/availability?from=2026-08-24T00:00:00.000Z&to=2026-08-25T00:00:00.000Z')
      .set('Cookie', employeeCookie)

    expect(employeeView.status).toBe(200)
    expect(employeeView.body.data.some((item: { source?: string }) => item.source === 'workforce_constraint')).toBe(false)
  })

  it('uses the same recurring workforce rule in capacity preview that visit PATCH enforces', async () => {
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const profile = await prisma.workforceProfile.findUniqueOrThrow({ where: { userId: employee.id } })

    await prisma.recurringUnavailability.create({
      data: {
        organizationId: profile.organizationId,
        profileId: profile.id,
        dayOfWeek: 1,
        startsMinute: 18 * 60,
        endsMinute: 22 * 60,
        reason: 'Other job every Monday',
      },
    })

    const response = await request(app)
      .post('/api/schedule-capacity')
      .set('Cookie', adminCookie)
      .send({
        userIds: [employee.id],
        windows: [
          { start: '2026-08-24T17:30:00.000Z', end: '2026-08-24T18:30:00.000Z' },
          { start: '2026-08-24T14:00:00.000Z', end: '2026-08-24T15:00:00.000Z' },
        ],
      })

    expect(response.status).toBe(200)
    expect(response.body.data.windows).toHaveLength(2)
    expect(response.body.data.windows[0]).toMatchObject({ total: 1, available: 0, blockedCount: 1 })
    expect(response.body.data.windows[0].blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({
        userId: employee.id,
        kind: 'recurring_unavailability',
        reason: 'Other job every Monday',
      }),
    ]))
    expect(response.body.data.windows[1]).toMatchObject({ total: 1, available: 1, blockedCount: 0 })
  })
})
