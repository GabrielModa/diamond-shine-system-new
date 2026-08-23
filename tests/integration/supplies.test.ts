import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { seedUsers, getAuthCookie, cleanSupplies } from './setup'
import { processNotificationJob } from '../../src/lib/notification-queue'
import { createSessionToken } from '../../src/lib/session'

vi.mock('../../src/lib/email', () => ({
  sendSuppliesNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendFeedbackNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendClientNotification: vi.fn().mockResolvedValue({ ok: true }),
}))

let app: ReturnType<typeof createServer>
let nextApp: ReturnType<typeof next>

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
})

let adminCookie: string
let supervisorCookie: string
let employeeCookie: string
let viewerCookie: string

beforeAll(async () => {
  adminCookie = await getAuthCookie('admin@ds.ie')
  supervisorCookie = await getAuthCookie('super@ds.ie')
  employeeCookie = await getAuthCookie('employee@ds.ie')
  viewerCookie = await getAuthCookie('viewer@ds.ie')
})

beforeEach(() => cleanSupplies())

const VALID_SUPPLY = {
  employeeName: 'Emma Employee',
  clientLocation: 'TechCorp Office - Dublin 2',
  priority: 'urgent',
  items: [
    { product: 'All-purpose cleaner', quantity: 3 },
    { product: 'Rubber gloves', quantity: 2 },
  ],
  notes: 'Need before 9am',
}

describe('POST /api/supplies', () => {
  it('employee creates a supply request → 201 with id', async () => {
    const res = await request(app).post('/api/supplies').set('Cookie', employeeCookie).send(VALID_SUPPLY)
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    const created = await prisma.supplyRequest.findUnique({ where: { id: res.body.data.id }, include: { items: true } })
    expect(created?.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ product: 'All-purpose cleaner', quantity: 3 })])
    )
    const createdEvent = await prisma.supplyStatusEvent.findFirst({ where: { requestId: res.body.data.id } })
    expect(createdEvent).toMatchObject({ fromStatus: null, toStatus: 'Requested', actorEmail: 'employee@ds.ie' })
    expect(typeof res.body.data.id).toBe('string')
  })

  it('viewer → 403', async () => {
    expect((await request(app).post('/api/supplies').set('Cookie', viewerCookie).send(VALID_SUPPLY)).status).toBe(403)
  })

  it('unauthenticated → 401', async () => {
    expect((await request(app).post('/api/supplies').send(VALID_SUPPLY)).status).toBe(401)
  })
})

describe('GET /api/supplies', () => {
  beforeEach(async () => {
    await prisma.supplyRequest.createMany({
      data: [
        { id: 'gs1', employeeName: 'A', clientLocation: 'TechCorp Office - Dublin 2', priority: 'urgent', products: '["All-purpose cleaner"]', status: 'Requested', submittedBy: 'employee@ds.ie' },
        { id: 'gs2', employeeName: 'B', clientLocation: 'Green Bank - Temple Bar', priority: 'normal', products: '["Bleach"]', status: 'Approved', submittedBy: 'employee@ds.ie' },
        { id: 'gs3', employeeName: 'C', clientLocation: 'Blue Industries - Ballsbridge', priority: 'low', products: '["Bin bags"]', status: 'Delivered', submittedBy: 'employee@ds.ie' },
      ],
    })
  })

  it('admin sees all 3 requests', async () => {
    expect((await request(app).get('/api/supplies').set('Cookie', adminCookie)).body.data.total).toBe(3)
  })

  it('employee sees only their own requests', async () => {
    await prisma.supplyRequest.create({
      data: { employeeName: 'Admin', clientLocation: 'Green Bank - Temple Bar', priority: 'normal', products: '["Bleach"]', submittedBy: 'admin@ds.ie' },
    })
    const res = await request(app).get('/api/supplies').set('Cookie', employeeCookie)
    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(3)
    expect(res.body.data.items.every((item: { submittedBy: string }) => item.submittedBy === 'employee@ds.ie')).toBe(true)
  })

  it('supports the dashboard batch size without rejecting the query', async () => {
    const res = await request(app).get('/api/supplies?limit=200').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.data.items).toHaveLength(3)
  })

  it('isolates requests by the organization stored in the session', async () => {
    const organization = await prisma.organization.upsert({
      where: { id: 'org_tenant_isolation' },
      update: { name: 'Tenant Isolation', slug: 'tenant-isolation' },
      create: { id: 'org_tenant_isolation', name: 'Tenant Isolation', slug: 'tenant-isolation' },
    })
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@ds.ie' } })
    await prisma.membership.upsert({
      where: {
        organizationId_userId: { organizationId: organization.id, userId: admin.id },
      },
      update: { role: 'organization_admin', status: 'active' },
      create: {
        organizationId: organization.id,
        userId: admin.id,
        role: 'organization_admin',
        status: 'active',
      },
    })
    await prisma.supplyRequest.create({
      data: {
        organizationId: organization.id,
        employeeName: 'Tenant B',
        clientLocation: 'Green Bank - Temple Bar',
        priority: 'normal',
        products: '["Bleach"]',
        submittedBy: admin.email,
      },
    })

    const tenantBCookie = `ds-session=${await createSessionToken(admin.email, 'admin', organization.id)}`
    const tenantAResponse = await request(app).get('/api/supplies').set('Cookie', adminCookie)
    const tenantBResponse = await request(app).get('/api/supplies').set('Cookie', tenantBCookie)

    expect(tenantAResponse.body.data.items.every(
      (item: { employeeName: string }) => item.employeeName !== 'Tenant B'
    )).toBe(true)
    expect(tenantBResponse.body.data.total).toBe(1)
    expect(tenantBResponse.body.data.items[0].employeeName).toBe('Tenant B')
  })
})

afterAll(async () => {
  await nextApp.close()
})

describe('PATCH /api/supplies/:id/status — status flow enforcement', () => {
  it('employee can cancel their own requested item', async () => {
    const row = await prisma.supplyRequest.create({
      data: { employeeName: 'Employee', clientLocation: 'TechCorp Office - Dublin 2', priority: 'normal', products: '["Bleach"]', status: 'Requested', submittedBy: 'employee@ds.ie' },
    })
    const res = await request(app).patch(`/api/supplies/${row.id}/status`).set('Cookie', employeeCookie).send({ status: 'Cancelled' })
    expect(res.status).toBe(200)
    expect((await prisma.supplyRequest.findUnique({ where: { id: row.id } }))?.status).toBe('Cancelled')
    expect(await prisma.supplyStatusEvent.count({ where: { requestId: row.id, toStatus: 'Cancelled' } })).toBe(1)
  })

  it('employee cannot cancel another users request', async () => {
    const row = await prisma.supplyRequest.create({
      data: { employeeName: 'Admin', clientLocation: 'TechCorp Office - Dublin 2', priority: 'normal', products: '["Bleach"]', status: 'Requested', submittedBy: 'admin@ds.ie' },
    })
    const res = await request(app).patch(`/api/supplies/${row.id}/status`).set('Cookie', employeeCookie).send({ status: 'Cancelled' })
    expect(res.status).toBe(403)
  })

  it('Requested → Triaged succeeds', async () => {
    await prisma.supplyRequest.create({
      data: {
        id: 'status1',
        employeeName: 'A',
        clientLocation: 'TechCorp Office - Dublin 2',
        priority: 'urgent',
        products: '["All-purpose cleaner"]',
        status: 'Requested',
        submittedBy: 'admin@ds.ie',
      },
    })
    const res = await request(app)
      .patch('/api/supplies/status1/status')
      .set('Cookie', adminCookie)
      .send({ status: 'Triaged' })
    expect(res.status).toBe(200)
  })

  it('In transit → Delivered succeeds', async () => {
    await prisma.supplyRequest.create({
      data: {
        id: 'status2',
        employeeName: 'B',
        clientLocation: 'Green Bank - Temple Bar',
        priority: 'normal',
        products: '["Bleach"]',
        status: 'InTransit',
        submittedBy: 'admin@ds.ie',
      },
    })
    const res = await request(app)
      .patch('/api/supplies/status2/status')
      .set('Cookie', adminCookie)
      .send({ status: 'Delivered' })
    expect(res.status).toBe(200)
  })

  it('Delivered → Triaged returns 409', async () => {
    await prisma.supplyRequest.create({
      data: {
        id: 'status3',
        employeeName: 'C',
        clientLocation: 'Blue Industries - Ballsbridge',
        priority: 'low',
        products: '["Bin bags"]',
        status: 'Delivered',
        submittedBy: 'admin@ds.ie',
      },
    })
    const res = await request(app)
      .patch('/api/supplies/status3/status')
      .set('Cookie', adminCookie)
      .send({ status: 'Triaged' })
    expect(res.status).toBe(409)
  })

  it('Delivered → Delivered returns 409', async () => {
    await prisma.supplyRequest.create({
      data: {
        id: 'status4',
        employeeName: 'D',
        clientLocation: 'Red Company - Dun Laoghaire',
        priority: 'urgent',
        products: '["Paper towels"]',
        status: 'Delivered',
        submittedBy: 'admin@ds.ie',
      },
    })
    const res = await request(app)
      .patch('/api/supplies/status4/status')
      .set('Cookie', adminCookie)
      .send({ status: 'Delivered' })
    expect(res.status).toBe(409)
  })
})

describe('POST /api/supplies/:id/notify', () => {
  it('response body has ok: true', async () => {
    await prisma.supplyRequest.create({
      data: {
        id: 'notify1',
        employeeName: 'E',
        clientLocation: 'TechCorp Office - Dublin 2',
        priority: 'urgent',
        products: '["All-purpose cleaner"]',
        status: 'Requested',
        submittedBy: 'admin@ds.ie',
      },
    })
    const res = await request(app)
      .post('/api/supplies/notify1/notify')
      .set('Cookie', adminCookie)
      .send({ clientEmail: 'client@example.com', subject: 'Test', htmlBody: '<p>hi</p>' })
    expect(res.status).toBe(202)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.queued).toBe(true)
  })

  it('does not change operational status after sending an email', async () => {
    await prisma.supplyRequest.create({
      data: {
        id: 'notify2',
        employeeName: 'F',
        clientLocation: 'Green Bank - Temple Bar',
        priority: 'normal',
        products: '["Bleach"]',
        status: 'Requested',
        submittedBy: 'admin@ds.ie',
      },
    })
    await request(app)
      .post('/api/supplies/notify2/notify')
      .set('Cookie', adminCookie)
      .send({ clientEmail: 'client@example.com', subject: 'Test', htmlBody: '<p>hi</p>' })
    const updated = await prisma.supplyRequest.findUnique({ where: { id: 'notify2' } })
    expect(updated?.status).toBe('Requested')
  })

  it('sets emailSentAt only after the queued notification is delivered', async () => {
    await prisma.supplyRequest.create({
      data: {
        id: 'notify3',
        employeeName: 'G',
        clientLocation: 'Blue Industries - Ballsbridge',
        priority: 'low',
        products: '["Bin bags"]',
        status: 'Requested',
        submittedBy: 'admin@ds.ie',
      },
    })
    const response = await request(app)
      .post('/api/supplies/notify3/notify')
      .set('Cookie', adminCookie)
      .send({ clientEmail: 'client@example.com', subject: 'Test', htmlBody: '<p>hi</p>' })
    expect((await prisma.supplyRequest.findUnique({ where: { id: 'notify3' } }))?.emailSentAt).toBeNull()
    await processNotificationJob(response.body.data.notificationJobId)
    const updated = await prisma.supplyRequest.findUnique({ where: { id: 'notify3' } })
    expect(updated?.emailSentAt).toBeTruthy()
  })
})

describe('PATCH /api/supplies/:id/assign', () => {
  it('admin assigns an active supervisor', async () => {
    const row = await prisma.supplyRequest.create({
      data: { employeeName: 'Employee', clientLocation: 'TechCorp Office - Dublin 2', priority: 'urgent', products: '["Bleach"]', status: 'Requested', submittedBy: 'employee@ds.ie' },
    })
    const res = await request(app)
      .patch(`/api/supplies/${row.id}/assign`)
      .set('Cookie', adminCookie)
      .send({ assigneeEmail: 'super@ds.ie' })
    expect(res.status).toBe(200)
    expect((await prisma.supplyRequest.findUnique({ where: { id: row.id } }))?.assignedTo).toBe('super@ds.ie')
  })

  it('rejects employees as assignees', async () => {
    const row = await prisma.supplyRequest.create({
      data: { employeeName: 'Employee', clientLocation: 'TechCorp Office - Dublin 2', priority: 'normal', products: '["Bleach"]', status: 'Requested', submittedBy: 'employee@ds.ie' },
    })
    const res = await request(app)
      .patch(`/api/supplies/${row.id}/assign`)
      .set('Cookie', adminCookie)
      .send({ assigneeEmail: 'employee@ds.ie' })
    expect(res.status).toBe(400)
  })

})
