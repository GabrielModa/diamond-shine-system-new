import { assertIntegrationDatabaseSafe } from './database-safety'
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { seedUsers, getAuthCookie } from './setup'
import { LEGACY_ORGANIZATION_ID } from '../../src/lib/tenancy'
import { issueAuthToken } from '../../src/lib/auth-tokens'
import bcrypt from 'bcryptjs'

vi.mock('../../src/lib/email', () => ({
  sendSuppliesNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendFeedbackNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendClientNotification: vi.fn().mockResolvedValue(undefined),
  sendUserInvite: vi.fn().mockResolvedValue({ ok: true }),
}))

let app: ReturnType<typeof createServer>
let nextApp: ReturnType<typeof next>
let adminCookie: string

beforeAll(async () => {
  process.env.NEXT_TEST_DIST_DIR = '.next-integration'
  nextApp = next({ dev: true, dir: process.cwd() })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()
  app = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })
  await seedUsers()
  adminCookie = await getAuthCookie('admin@ds.ie')
})

beforeEach(async () => {
  assertIntegrationDatabaseSafe()
  await prisma.authRateLimit.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.authToken.deleteMany()
  await prisma.operationalNotice.deleteMany({ where: { createdBy: { email: { contains: '@test.io' } } } })
  await prisma.user.deleteMany({ where: { email: { contains: '@test.io' } } })
  await prisma.user.update({ where: { email: 'admin@ds.ie' }, data: { role: 'admin', status: 'active' } })
})

afterAll(async () => {
  await nextApp.close()
})

describe('protected page authorization', () => {
  it('applies a membership role change immediately even when the session cookie is older', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@ds.ie' } })
    const where = {
      organizationId_userId: {
        organizationId: LEGACY_ORGANIZATION_ID,
        userId: admin.id,
      },
    }
    await prisma.membership.update({ where, data: { role: 'viewer' } })
    try {
      const response = await request(app).get('/dashboard').set('Cookie', adminCookie)
      expect(response.status).toBe(307)
      expect(response.headers.location).toBe('/forbidden')
    } finally {
      await prisma.membership.update({ where, data: { role: 'organization_admin' } })
    }
  })
})

describe('POST /api/users invite', () => {
  it('admin can invite pending user', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Cookie', adminCookie)
      .send({ email: 'new@test.io', name: 'New User', role: 'employee' })
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.tempPassword).toBeUndefined()
    const user = await prisma.user.findUnique({ where: { email: 'new@test.io' } })
    expect(user?.status).toBe('pending')
    expect(user?.password).toBeNull()
    const token = await prisma.authToken.findFirst({ where: { userId: user?.id, type: 'invite' } })
    expect(token?.tokenHash).toHaveLength(64)
  })

  it('falls back to a secure manual link and activates field staff only after operational profile setup', async () => {
    const previousTransport = process.env.EMAIL_TRANSPORT
    const previousSmtpPort = process.env.SMTP_PORT
    const invited = await (async () => {
      try {
        process.env.EMAIL_TRANSPORT = 'smtp'
        process.env.SMTP_PORT = '0'
        return await request(app)
          .post('/api/users')
          .set('Cookie', adminCookie)
          .send({ email: 'onboarding@test.io', name: 'Onboarding User', membershipRole: 'employee' })
      } finally {
        if (previousTransport === undefined) delete process.env.EMAIL_TRANSPORT
        else process.env.EMAIL_TRANSPORT = previousTransport
        if (previousSmtpPort === undefined) delete process.env.SMTP_PORT
        else process.env.SMTP_PORT = previousSmtpPort
      }
    })()

    expect(invited.status).toBe(201)
    expect(invited.body.data.emailSent).toBe(false)
    expect(invited.body.data.manualInviteUrl).toContain('/set-password?token=')

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'onboarding@test.io' } })
    const blocked = await request(app)
      .patch(`/api/users/${user.id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'active' })
    expect(blocked.status).toBe(409)
    expect(blocked.body.error).toContain('create a password')

    const token = new URL(invited.body.data.manualInviteUrl).searchParams.get('token')
    expect(token).toBeTruthy()
    const password = 'DiamondShine123!'
    const passwordSaved = await request(app)
      .post('/api/auth/set-password')
      .send({ token, password })
    expect(passwordSaved.status).toBe(200)
    expect(passwordSaved.body.data.stage).toBe('profile')

    const [stagedUser, stagedMembership] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.membership.findFirstOrThrow({ where: { userId: user.id, organizationId: LEGACY_ORGANIZATION_ID } }),
    ])
    expect(stagedUser.status).toBe('pending')
    expect(stagedUser.password).toBeTruthy()
    expect(stagedMembership.status).toBe('invited')

    const blockedLogin = await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '203.0.113.44')
      .send({ email: 'onboarding@test.io', password })
    expect(blockedLogin.status).toBe(403)

    const previousPlacesTestMode = process.env.PLACES_TEST_MODE
    const completed = await (async () => {
      try {
        process.env.PLACES_TEST_MODE = '1'
        return await request(app)
          .post('/api/auth/invite-setup')
          .send({
            token,
            phone: '+353871234567',
            homePlaceId: 'test-home-onboarding',
            travelMode: 'transit',
            emergencyContact: null,
            schoolPlaceId: null,
            studySchedule: [],
            recurringUnavailability: [],
          })
      } finally {
        if (previousPlacesTestMode === undefined) delete process.env.PLACES_TEST_MODE
        else process.env.PLACES_TEST_MODE = previousPlacesTestMode
      }
    })()
    expect(completed.status).toBe(200)

    const [savedUser, membership, profile] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
      prisma.membership.findFirstOrThrow({ where: { userId: user.id, organizationId: LEGACY_ORGANIZATION_ID } }),
      prisma.workforceProfile.findUniqueOrThrow({ where: { userId: user.id } }),
    ])
    expect(savedUser.status).toBe('active')
    expect(membership.status).toBe('active')
    expect(profile.homeAddress).toBe('10 Test Street, Dublin 8, Ireland')

    const login = await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '203.0.113.44')
      .send({ email: 'onboarding@test.io', password })
    expect(login.status).toBe(200)
  })
})

describe('GET /api/users', () => {
  it('never exposes password hashes', async () => {
    const res = await request(app).get('/api/users').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(res.body.data.every((user: Record<string, unknown>) => !('password' in user))).toBe(true)
    expect(res.body.data.every((user: Record<string, unknown>) => typeof user.hasPassword === 'boolean')).toBe(true)
  })
})

describe('POST /api/auth/login', () => {
  it('rate limits repeated invalid credentials without exposing the account', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app)
        .post('/api/auth/login')
        .set('x-forwarded-for', '203.0.113.10')
        .send({ email: 'admin@ds.ie', password: 'incorrect-password' })
      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Incorrect email or password')
    }

    const blocked = await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '203.0.113.10')
      .send({ email: 'admin@ds.ie', password: 'incorrect-password' })
    expect(blocked.status).toBe(429)
    expect(blocked.headers['retry-after']).toBeTruthy()
  })

  it('enforces the login limit under concurrent invalid attempts', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '203.0.113.12')
      .send({ email: 'admin@ds.ie', password: 'incorrect-password' })))

    expect(responses.filter((response) => response.status === 401)).toHaveLength(5)
    expect(responses.filter((response) => response.status === 429)).toHaveLength(3)
  })

  it('clears the attempt counter after a successful sign-in', async () => {
    await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '203.0.113.11')
      .send({ email: 'admin@ds.ie', password: 'incorrect-password' })

    const success = await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '203.0.113.11')
      .send({ email: 'admin@ds.ie', password: 'password123' })
    expect(success.status).toBe(200)
    expect(await prisma.authRateLimit.count()).toBe(0)
  })
})

describe('POST /api/auth/reset-password', () => {
  it('revokes native bearer sessions when account credentials are reset', async () => {
    const password = await bcrypt.hash('OldPassword123!', 12)
    const user = await prisma.user.create({
      data: { email: 'reset-session@test.io', name: 'Reset Session', role: 'employee', status: 'active', password },
    })
    await prisma.membership.create({
      data: {
        organizationId: LEGACY_ORGANIZATION_ID,
        userId: user.id,
        role: 'employee',
        status: 'active',
      },
    })

    const login = await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '203.0.113.13')
      .send({ email: user.email, password: 'OldPassword123!', mobile: true, deviceName: 'reset-test-device' })
    expect(login.status).toBe(200)
    expect(login.body.data.accessToken).toBeTruthy()
    expect(await prisma.mobileSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(1)

    const resetToken = await issueAuthToken(user.id, 'password_reset', LEGACY_ORGANIZATION_ID)
    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken.token, password: 'NewPassword123!' })
    expect(reset.status).toBe(200)
    expect(await prisma.mobileSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(0)

    const staleSession = await request(app)
      .get('/api/operational-notices?scope=mine')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
    expect(staleSession.status).toBe(401)
  })
})

describe('POST /api/users/:id/invite', () => {
  it('reissues a one-time invitation for a pending user', async () => {
    const user = await prisma.user.create({ data: { email: 'resend@test.io', name: 'Resend', role: 'employee', status: 'pending' } })
    await prisma.membership.create({
      data: {
        organizationId: LEGACY_ORGANIZATION_ID,
        userId: user.id,
        role: 'employee',
        status: 'invited',
      },
    })
    const res = await request(app).post(`/api/users/${user.id}/invite`).set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.data.tempPassword).toBeUndefined()
    expect(await prisma.authToken.count({ where: { userId: user.id, type: 'invite', usedAt: null } })).toBe(1)
  })
})

describe('admin-assisted scheduling profile', () => {
  it('lets an organization admin assist school and recurring availability with an audit trail', async () => {
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const previousGeocodingMode = process.env.GEOCODING_TEST_MODE
    try {
      process.env.GEOCODING_TEST_MODE = '1'
      const response = await request(app)
        .patch(`/api/workforce/profiles/${employee.id}`)
        .set('Cookie', adminCookie)
        .send({
          school: { name: 'Trinity College Dublin', address: 'College Green, Dublin 2, Ireland' },
          studySchedule: [{ dayOfWeek: 1, startsMinute: 540, endsMinute: 720 }],
          recurringUnavailability: [{ dayOfWeek: 4, startsMinute: 1080, endsMinute: 1320, reason: 'Family commitment' }],
        })

      expect(response.status).toBe(200)
      const profile = await prisma.workforceProfile.findUniqueOrThrow({
        where: { userId: employee.id },
        include: { studySchedules: true, recurringUnavailability: true },
      })
      expect(profile.schoolName).toBe('Trinity College Dublin')
      expect(profile.schoolLatitude).not.toBeNull()
      expect(profile.studySchedules).toEqual([expect.objectContaining({ dayOfWeek: 1, startsMinute: 540, endsMinute: 720 })])
      expect(profile.recurringUnavailability).toEqual([expect.objectContaining({ dayOfWeek: 4, reason: 'Family commitment' })])
      expect(await prisma.auditLog.findFirst({
        where: { action: 'admin_assist_workforce_scheduling_profile', targetId: profile.id },
      })).not.toBeNull()
    } finally {
      if (previousGeocodingMode === undefined) delete process.env.GEOCODING_TEST_MODE
      else process.env.GEOCODING_TEST_MODE = previousGeocodingMode
      const profile = await prisma.workforceProfile.findUnique({ where: { userId: employee.id } })
      if (profile) {
        await prisma.studySchedule.deleteMany({ where: { profileId: profile.id } })
        await prisma.recurringUnavailability.deleteMany({ where: { profileId: profile.id } })
      }
    }
  })

  it('returns active broadcast recipients with their organization roles', async () => {
    const response = await request(app).get('/api/operational-notices/recipients').set('Cookie', adminCookie)
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: 'employee@ds.ie', role: 'employee' }),
      expect.objectContaining({ email: 'super@ds.ie', role: 'field_supervisor' }),
      expect.objectContaining({ email: 'admin@ds.ie', role: 'organization_admin' }),
    ]))
  })
})

describe('communications bootstrap', () => {
  it('returns inbox and manager targeting data through one scoped read', async () => {
    const response = await request(app).get('/api/communications/bootstrap').set('Cookie', adminCookie)
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual(expect.objectContaining({
      mine: expect.objectContaining({ items: expect.any(Array), summary: expect.any(Object) }),
      all: expect.objectContaining({ items: expect.any(Array), summary: expect.any(Object) }),
      people: expect.arrayContaining([
        expect.objectContaining({ email: 'employee@ds.ie', role: 'employee' }),
        expect.objectContaining({ email: 'super@ds.ie', role: 'field_supervisor' }),
      ]),
      sites: expect.any(Array),
      canManage: true,
    }))
  })
})

describe('communications validation', () => {
  it('rejects invalid notification recipient lists', async () => {
    const res = await request(app).put('/api/settings').set('Cookie', adminCookie).send({
      supplyAlerts: 'valid@company.ie, not-an-email',
      feedbackAlerts: 'quality@company.ie',
    })
    expect(res.status).toBe(400)
  })

  it('rejects executable HTML in templates', async () => {
    const res = await request(app).put('/api/templates').set('Cookie', adminCookie).send({
      key: 'unsafe_test', subject: 'Unsafe', body: '<script>alert(1)</script>',
    })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/users/:id/status', () => {
  it('prevents administrators from bypassing required field-staff account setup', async () => {
    const user = await prisma.user.create({
      data: { email: 'pending@test.io', name: 'Pending', role: 'employee', status: 'pending', password: 'hash' },
    })
    await prisma.membership.create({
      data: {
        organizationId: LEGACY_ORGANIZATION_ID,
        userId: user.id,
        role: 'employee',
        status: 'invited',
      },
    })
    const res = await request(app)
      .patch(`/api/users/${user.id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'active' })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('secure account setup')
    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.status).toBe('pending')
  })

  it('prevents an administrator from deactivating their own account', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@ds.ie' } })
    const res = await request(app)
      .patch(`/api/users/${admin.id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'inactive' })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('own account')
  })

  it('revokes and restores live access when a disposable membership is deactivated, reactivated, then removed', async () => {
    const email = 'access-lifecycle@test.io'
    const password = 'AccessLifecycle123!'
    const user = await prisma.user.create({
      data: {
        email,
        name: 'Access Lifecycle',
        role: 'viewer',
        status: 'active',
        password: await bcrypt.hash(password, 12),
      },
    })
    await prisma.membership.create({
      data: {
        organizationId: LEGACY_ORGANIZATION_ID,
        userId: user.id,
        role: 'viewer',
        status: 'active',
      },
    })

    const login = await request(app)
      .post('/api/auth/login')
      .set('x-forwarded-for', '203.0.113.77')
      .send({ email, password })
    expect(login.status).toBe(200)
    const userCookie = login.headers['set-cookie']?.[0]
    expect(userCookie).toContain('ds-session=')

    const before = await request(app).get('/api/clients').set('Cookie', userCookie)
    expect(before.status).toBe(200)

    const deactivated = await request(app)
      .patch(`/api/users/${user.id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'inactive' })
    expect(deactivated.status).toBe(200)
    expect((await request(app).get('/api/clients').set('Cookie', userCookie)).status).toBe(401)

    const reactivated = await request(app)
      .patch(`/api/users/${user.id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'active' })
    expect(reactivated.status).toBe(200)
    expect((await request(app).get('/api/clients').set('Cookie', userCookie)).status).toBe(200)

    const removed = await request(app)
      .delete(`/api/users/${user.id}`)
      .set('Cookie', adminCookie)
      .send({ confirmEmail: email })
    expect(removed.status).toBe(200)
    expect(removed.body.data.mode).toBe('removed')
    expect(removed.body.data.message).toContain('Historical operational records were preserved')
    expect((await request(app).get('/api/clients').set('Cookie', userCookie)).status).toBe(401)
  })
})

describe('PATCH /api/users/:id/role', () => {
  it('admin can change role', async () => {
    const user = await prisma.user.create({
      data: { email: 'role@test.io', name: 'Role', role: 'employee', status: 'active', password: 'hash' },
    })
    await prisma.membership.create({
      data: {
        organizationId: LEGACY_ORGANIZATION_ID,
        userId: user.id,
        role: 'employee',
        status: 'active',
      },
    })
    const res = await request(app)
      .patch(`/api/users/${user.id}/role`)
      .set('Cookie', adminCookie)
      .send({ role: 'supervisor' })
    expect(res.status).toBe(200)
    const updated = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: LEGACY_ORGANIZATION_ID,
          userId: user.id,
        },
      },
    })
    expect(updated?.role).toBe('field_supervisor')
  })

  it('prevents an administrator from removing their own role', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@ds.ie' } })
    const res = await request(app)
      .patch(`/api/users/${admin.id}/role`)
      .set('Cookie', adminCookie)
      .send({ role: 'viewer' })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('own organization administrator role')
  })
})

describe('GET /api/templates', () => {
  it('admin can fetch templates', async () => {
    const res = await request(app).get('/api/templates').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('initializes defaults safely under concurrent requests', async () => {
    await prisma.emailTemplate.deleteMany()
    const [first, second] = await Promise.all([
      request(app).get('/api/templates').set('Cookie', adminCookie),
      request(app).get('/api/templates').set('Cookie', adminCookie),
    ])
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await prisma.emailTemplate.count()).toBe(3)
  })
})

describe('organization context', () => {
  it('lists memberships and issues a scoped session when switching organization', async () => {
    const organization = await prisma.organization.upsert({
      where: { id: 'org_switch_test' },
      update: { name: 'Switch Test', slug: 'switch-test' },
      create: { id: 'org_switch_test', name: 'Switch Test', slug: 'switch-test' },
    })
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@ds.ie' } })
    await prisma.membership.upsert({
      where: {
        organizationId_userId: { organizationId: organization.id, userId: admin.id },
      },
      update: { role: 'field_supervisor', status: 'active' },
      create: {
        organizationId: organization.id,
        userId: admin.id,
        role: 'field_supervisor',
        status: 'active',
      },
    })

    const listed = await request(app).get('/api/organizations').set('Cookie', adminCookie)
    expect(listed.status).toBe(200)
    expect(listed.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: LEGACY_ORGANIZATION_ID, current: true }),
      expect.objectContaining({ id: organization.id, role: 'supervisor', current: false }),
    ]))

    const switched = await request(app)
      .post('/api/organizations/switch')
      .set('Cookie', adminCookie)
      .send({ organizationId: organization.id })
    expect(switched.status).toBe(200)
    expect(switched.body.data).toEqual({ organizationId: organization.id, role: 'supervisor' })
    expect(switched.headers['set-cookie']?.[0]).toContain('ds-session=')
  })
})

describe('GET /api/audit', () => {
  it('returns audit entries', async () => {
    await prisma.auditLog.create({
      data: {
        actorEmail: 'admin@ds.ie',
        action: 'test',
        targetType: 'user',
      },
    })
    const res = await request(app).get('/api/audit').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.items.length).toBeGreaterThan(0)
    expect(res.body.data.total).toBeGreaterThan(0)
    expect(res.body.data.page).toBe(1)
  })
})
