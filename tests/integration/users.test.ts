import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { seedUsers, getAuthCookie } from './setup'
import { LEGACY_ORGANIZATION_ID } from '../../src/lib/tenancy'

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
  await prisma.authRateLimit.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.authToken.deleteMany()
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
})

describe('GET /api/users', () => {
  it('never exposes password hashes', async () => {
    const res = await request(app).get('/api/users').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.data.length).toBeGreaterThan(0)
    expect(res.body.data.every((user: Record<string, unknown>) => !('password' in user))).toBe(true)
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
  it('admin can approve pending user', async () => {
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
    expect(res.status).toBe(200)
    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.status).toBe('active')
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
