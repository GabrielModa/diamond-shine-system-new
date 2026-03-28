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
  await prisma.auditLog.deleteMany()
  await prisma.user.deleteMany({ where: { email: { contains: '@test.io' } } })
})

describe('POST /api/users invite', () => {
  it('admin can invite pending user', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Cookie', adminCookie)
      .send({ email: 'new@test.io', name: 'New User', role: 'employee' })
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    const user = await prisma.user.findUnique({ where: { email: 'new@test.io' } })
    expect(user?.status).toBe('pending')
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
