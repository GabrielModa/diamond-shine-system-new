import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { seedUsers, getAuthCookie } from './setup'

vi.mock('../../src/lib/email', () => ({
  sendSuppliesNotification: vi.fn().mockResolvedValue(undefined),
  sendFeedbackNotification: vi.fn().mockResolvedValue(undefined),
  sendClientNotification: vi.fn().mockResolvedValue(undefined),
  sendUserInvite: vi.fn().mockResolvedValue({ ok: true }),
}))

let app: ReturnType<typeof createServer>
let adminCookie: string

beforeAll(async () => {
  const nextApp = next({ dev: true, dir: process.cwd() })
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

describe('protected page authorization', () => {
  it('applies a role change immediately even when the session cookie is older', async () => {
    await prisma.user.update({ where: { email: 'admin@ds.ie' }, data: { role: 'employee' } })
    const response = await request(app).get('/dashboard').set('Cookie', adminCookie)
    expect(response.status).toBe(307)
    expect(response.headers.location).toBe('/forbidden')
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
    const res = await request(app)
      .patch(`/api/users/${user.id}/role`)
      .set('Cookie', adminCookie)
      .send({ role: 'supervisor' })
    expect(res.status).toBe(200)
    const updated = await prisma.user.findUnique({ where: { id: user.id } })
    expect(updated?.role).toBe('supervisor')
  })

  it('prevents an administrator from removing their own role', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@ds.ie' } })
    const res = await request(app)
      .patch(`/api/users/${admin.id}/role`)
      .set('Cookie', adminCookie)
      .send({ role: 'viewer' })
    expect(res.status).toBe(409)
    expect(res.body.error).toContain('own administrator role')
  })
})

describe('GET /api/templates', () => {
  it('admin can fetch templates', async () => {
    const res = await request(app).get('/api/templates').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
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
    expect(res.body.data.length).toBeGreaterThan(0)
  })
})
