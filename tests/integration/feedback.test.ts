import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { seedUsers, getAuthCookie, cleanFeedback } from './setup'

vi.mock('../../src/lib/email', () => ({
  sendSuppliesNotification: vi.fn().mockResolvedValue(undefined),
  sendFeedbackNotification: vi.fn().mockResolvedValue(undefined),
  sendClientNotification: vi.fn().mockResolvedValue(undefined),
}))

let app: ReturnType<typeof createServer>
let adminCookie: string, supervisorCookie: string, employeeCookie: string

beforeAll(async () => {
  const nextApp = next({ dev: false, dir: process.cwd() })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()
  app = createServer((req, res) => handle(req, res, parse(req.url!, true)))
  await seedUsers()
  adminCookie = await getAuthCookie('admin@ds.ie')
  supervisorCookie = await getAuthCookie('super@ds.ie')
  employeeCookie = await getAuthCookie('employee@ds.ie')
})

beforeEach(() => cleanFeedback())

const VALID_FEEDBACK = {
  employeeName: 'Emma Employee',
  clientLocation: 'TechCorp Office - Dublin 2',
  cleanliness: 5.0,
  punctuality: 4.5,
  equipment: 5.0,
  clientRelations: 4.5,
  comments: 'Great work',
}

describe('POST /api/feedback', () => {
  it('supervisor creates feedback → 201', async () => {
    const res = await request(app).post('/api/feedback').set('Cookie', supervisorCookie).send(VALID_FEEDBACK)
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
  })

  it('employee → 403', async () => {
    expect((await request(app).post('/api/feedback').set('Cookie', employeeCookie).send(VALID_FEEDBACK)).status).toBe(403)
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
