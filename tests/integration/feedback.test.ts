import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
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
let adminCookie: string, supervisorCookie: string, employeeCookie: string

beforeAll(async () => {
  const nextApp = next({ dev: true, dir: process.cwd() })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()
  app = createServer((req, res) => handle(req, res, parse(req.url!, true)))
  await seedUsers()
  adminCookie = await getAuthCookie('admin@ds.ie')
  supervisorCookie = await getAuthCookie('super@ds.ie')
  employeeCookie = await getAuthCookie('employee@ds.ie')
})

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
  it('supervisor creates feedback → 201', async () => {
    const res = await request(app).post('/api/feedback').set('Cookie', supervisorCookie).send(await validFeedback())
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
  })

  it('employee → 403', async () => {
    expect((await request(app).post('/api/feedback').set('Cookie', employeeCookie).send(await validFeedback())).status).toBe(403)
  })

  it('rejects feedback for an unknown employee', async () => {
    const payload = { ...(await validFeedback()), employeeId: 'missing-user' }
    const res = await request(app).post('/api/feedback').set('Cookie', supervisorCookie).send(payload)
    expect(res.status).toBe(400)
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
    await prisma.feedbackEntry.createMany({
      data: [
        { id: 'gf1', employeeName: 'A', clientLocation: 'TechCorp Office - Dublin 2', cleanliness: 5, punctuality: 5, equipment: 5, clientRelations: 5, overall: 5, category: 'Excellent', submittedBy: 'super@ds.ie' },
        { id: 'gf2', employeeName: 'B', clientLocation: 'Green Bank - Temple Bar', cleanliness: 3, punctuality: 3, equipment: 3, clientRelations: 3, overall: 3, category: 'Good', submittedBy: 'admin@ds.ie' },
      ],
    })
  })

  it('admin sees all 2 entries', async () => {
    expect((await request(app).get('/api/feedback').set('Cookie', adminCookie)).body.data.total).toBe(2)
  })
})
