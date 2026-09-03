import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { seedUsers, getAuthCookie, cleanFeedback } from './setup'

vi.mock('../../src/lib/email', () => ({
  sendSuppliesNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendFeedbackNotification: vi.fn().mockResolvedValue({ ok: true }),
  sendClientNotification: vi.fn().mockResolvedValue(undefined),
}))

let app: ReturnType<typeof createServer>
let nextApp: ReturnType<typeof next>
let adminCookie: string, supervisorCookie: string, employeeCookie: string

beforeAll(async () => {
  process.env.NEXT_TEST_DIST_DIR = '.next-integration'
  nextApp = next({ dev: true, dir: process.cwd() })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()
  app = createServer((req, res) => handle(req, res, parse(req.url!, true)))
  await seedUsers()
  adminCookie = await getAuthCookie('admin@ds.ie')
  supervisorCookie = await getAuthCookie('super@ds.ie')
  employeeCookie = await getAuthCookie('employee@ds.ie')
}, 30_000)

beforeEach(() => cleanFeedback())

async function validFeedback() {
  const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
  return {
    employeeId: employee.id,
    clientLocation: 'TechCorp Office - Dublin 2',
    cleanliness: 5.0,
    punctuality: 4.5,
    equipment: 5.0,
    clientRelations: 4.5,
    comments: 'Great work',
  }
}

describe('POST /api/feedback', () => {
  it('supervisor creates feedback and the server owns employee identity, score and category', async () => {
    const payload = await validFeedback()
    const res = await request(app).post('/api/feedback').set('Cookie', supervisorCookie).send(payload)
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)

    const stored = await prisma.feedbackEntry.findUniqueOrThrow({ where: { id: res.body.data.id } })
    expect(stored.employeeId).toBe(payload.employeeId)
    expect(stored.employeeName).toBe('Employee')
    expect(stored.submittedBy).toBe('super@ds.ie')
    expect(stored.overall).toBe(4.75)
    expect(stored.category).toBe('Excellent')
  })

  it('employee cannot create feedback', async () => {
    expect((await request(app).post('/api/feedback').set('Cookie', employeeCookie).send(await validFeedback())).status).toBe(403)
  })

  it('requires authentication', async () => {
    expect((await request(app).post('/api/feedback').send(await validFeedback())).status).toBe(401)
  })

  it('rejects feedback for an unknown employee', async () => {
    const payload = { ...(await validFeedback()), employeeId: 'missing-user' }
    const res = await request(app).post('/api/feedback').set('Cookie', supervisorCookie).send(payload)
    expect(res.status).toBe(400)
    expect(await prisma.feedbackEntry.count()).toBe(0)
  })

  it('rejects ratings outside the supported scale without persisting partial data', async () => {
    const payload = { ...(await validFeedback()), cleanliness: 7 }
    const res = await request(app).post('/api/feedback').set('Cookie', supervisorCookie).send(payload)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Invalid ratings/i)
    expect(await prisma.feedbackEntry.count()).toBe(0)
  })
})

describe('GET /api/employees', () => {
  it('returns active employees to supervisors', async () => {
    const res = await request(app).get('/api/employees').set('Cookie', supervisorCookie)
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: 'employee@ds.ie' })])
    )
  })

  it('does not expose the directory to employees', async () => {
    const res = await request(app).get('/api/employees').set('Cookie', employeeCookie)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/feedback', () => {
  beforeEach(async () => {
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    await prisma.feedbackEntry.createMany({
      data: [
        { id: 'gf1', employeeId: employee.id, employeeName: 'A', clientLocation: 'TechCorp Office - Dublin 2', cleanliness: 5, punctuality: 5, equipment: 5, clientRelations: 5, overall: 5, category: 'Excellent', submittedBy: 'super@ds.ie' },
        { id: 'gf2', employeeId: employee.id, employeeName: 'B', clientLocation: 'Green Bank - Temple Bar', cleanliness: 3, punctuality: 3, equipment: 3, clientRelations: 3, overall: 3, category: 'Good', submittedBy: 'admin@ds.ie' },
      ],
    })
  })

  it('admin sees all organization feedback', async () => {
    const res = await request(app).get('/api/feedback').set('Cookie', adminCookie)
    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(2)
    expect(res.body.data.items).toHaveLength(2)
  })

  it('supervisor sees only feedback they submitted', async () => {
    const res = await request(app).get('/api/feedback').set('Cookie', supervisorCookie)
    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(1)
    expect(res.body.data.items).toEqual([
      expect.objectContaining({ id: 'gf1', submittedBy: 'super@ds.ie', category: 'Excellent' }),
    ])
  })

  it('does not expose manager feedback to employees or anonymous callers', async () => {
    expect((await request(app).get('/api/feedback').set('Cookie', employeeCookie)).status).toBe(403)
    expect((await request(app).get('/api/feedback')).status).toBe(401)
  })
})

afterAll(async () => {
  await cleanFeedback()
  await nextApp.close()
})
