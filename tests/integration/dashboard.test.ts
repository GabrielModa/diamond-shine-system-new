import { assertIntegrationDatabaseSafe } from './database-safety'
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { seedUsers, getAuthCookie } from './setup'

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
})

beforeEach(async () => {
  assertIntegrationDatabaseSafe()
  await prisma.supplyRequest.deleteMany()
  await prisma.feedbackEntry.deleteMany()
})

describe('GET /api/dashboard', () => {
  it('admin → 200', async () => {
    expect((await request(app).get('/api/dashboard').set('Cookie', adminCookie)).status).toBe(200)
  })

  it('preserves dashboard aggregates while only returning recent rows', async () => {
    await prisma.supplyRequest.create({
      data: {
        employeeName: 'Admin',
        clientLocation: 'Blue Industries - Ballsbridge',
        priority: 'urgent',
        products: '["Legacy soap"]',
        status: 'Requested',
        submittedBy: 'admin@ds.ie',
        items: { create: [{ product: 'Gloves', quantity: 4 }] },
      },
    })
    await prisma.supplyRequest.create({
      data: {
        employeeName: 'Admin',
        clientLocation: 'Blue Industries - Ballsbridge',
        priority: 'normal',
        products: '["Gloves"]',
        status: 'Delivered',
        submittedBy: 'admin@ds.ie',
      },
    })
    await prisma.feedbackEntry.createMany({
      data: [
        {
          employeeName: 'Employee', clientLocation: 'Blue Industries - Ballsbridge',
          cleanliness: 5, punctuality: 5, equipment: 5, clientRelations: 5,
          overall: 5, category: 'Excellent', submittedBy: 'admin@ds.ie',
        },
        {
          employeeName: 'Employee', clientLocation: 'Blue Industries - Ballsbridge',
          cleanliness: 4, punctuality: 4, equipment: 4, clientRelations: 4,
          overall: 4, category: 'Good', submittedBy: 'admin@ds.ie',
        },
      ],
    })

    const response = await request(app).get('/api/dashboard').set('Cookie', adminCookie)
    expect(response.status).toBe(200)
    expect(response.body.data.supplies).toEqual(expect.objectContaining({
      total: 2,
      byStatus: expect.objectContaining({ requested: 1, delivered: 1 }),
      byPriority: expect.objectContaining({ urgent: 1, normal: 0 }),
      mostRequestedProduct: 'Gloves',
    }))
    expect(response.body.data.supplies.recent).toHaveLength(2)
    expect(response.body.data.feedback).toEqual(expect.objectContaining({
      total: 2,
      averageOverall: 4.5,
      excellentCount: 1,
    }))
    expect(response.body.data.feedback.recent).toHaveLength(2)
  })

  it('employee → 403', async () => {
    expect((await request(app).get('/api/dashboard').set('Cookie', employeeCookie)).status).toBe(403)
  })

  it('unauthenticated → 401', async () => {
    expect((await request(app).get('/api/dashboard')).status).toBe(401)
  })
})

afterAll(async () => {
  await nextApp.close()
})

describe('GET /api/health', () => {
  it('reports database readiness without authentication', async () => {
    const response = await request(app).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ ok: true, data: { status: 'ready', database: 'available' } })
    expect(response.headers['cache-control']).toBe('no-store')
  })
})
