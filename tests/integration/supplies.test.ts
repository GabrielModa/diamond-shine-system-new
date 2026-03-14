import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { seedUsers, getAuthCookie, cleanSupplies } from './setup'

vi.mock('../../src/lib/email', () => ({
  sendSuppliesNotification: vi.fn().mockResolvedValue(undefined),
  sendFeedbackNotification: vi.fn().mockResolvedValue(undefined),
  sendClientNotification: vi.fn().mockResolvedValue(undefined),
}))

let app: ReturnType<typeof createServer>

beforeAll(async () => {
  const nextApp = next({ dev: true, dir: process.cwd() })
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
  products: ['All-purpose cleaner', 'Rubber gloves'],
  notes: 'Need before 9am',
}

describe('POST /api/supplies', () => {
  it('employee creates a supply request → 201 with id', async () => {
    const res = await request(app).post('/api/supplies').set('Cookie', employeeCookie).send(VALID_SUPPLY)
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
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
        { id: 'gs1', employeeName: 'A', clientLocation: 'TechCorp Office - Dublin 2', priority: 'urgent', products: '["All-purpose cleaner"]', status: 'Pending', submittedBy: 'employee@ds.ie' },
        { id: 'gs2', employeeName: 'B', clientLocation: 'Green Bank - Temple Bar', priority: 'normal', products: '["Bleach"]', status: 'Email Sent', submittedBy: 'employee@ds.ie' },
        { id: 'gs3', employeeName: 'C', clientLocation: 'Blue Industries - Ballsbridge', priority: 'low', products: '["Bin bags"]', status: 'Completed', submittedBy: 'employee@ds.ie' },
      ],
    })
  })

  it('admin sees all 3 requests', async () => {
    expect((await request(app).get('/api/supplies').set('Cookie', adminCookie)).body.data.total).toBe(3)
  })

  it('employee → 403', async () => {
    expect((await request(app).get('/api/supplies').set('Cookie', employeeCookie)).status).toBe(403)
  })
})
