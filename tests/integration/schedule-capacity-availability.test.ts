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

beforeAll(async () => {
  process.env.NEXT_TEST_DIST_DIR = '.next-integration'
  nextApp = next({ dev: true, dir: process.cwd() })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()
  app = createServer((req, res) => handle(req, res, parse(req.url!, true)))
  await seedUsers()
  adminCookie = await getAuthCookie('admin@ds.ie')
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

describe('schedule capacity preview', () => {
  it('uses the same recurring workforce rule that visit PATCH enforces', async () => {
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

  it('treats school and personal leave as unavailable capacity', async () => {
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

    const response = await request(app)
      .post('/api/schedule-capacity')
      .set('Cookie', adminCookie)
      .send({
        userIds: [employee.id],
        windows: [
          { start: '2026-08-24T08:30:00.000Z', end: '2026-08-24T09:30:00.000Z' },
          { start: '2026-08-24T13:15:00.000Z', end: '2026-08-24T13:45:00.000Z' },
        ],
      })

    expect(response.status).toBe(200)
    expect(response.body.data.windows[0].blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: employee.id, kind: 'school' }),
    ]))
    expect(response.body.data.windows[1].blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: employee.id, kind: 'personal_leave', reason: 'Appointment' }),
    ]))
  })
})
