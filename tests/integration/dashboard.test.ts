import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { seedUsers, getAuthCookie } from './setup'

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

beforeEach(async () => {
  await prisma.supplyRequest.deleteMany()
  await prisma.feedbackEntry.deleteMany()
})

describe('GET /api/dashboard', () => {
  it('admin → 200', async () => {
    expect((await request(app).get('/api/dashboard').set('Cookie', adminCookie)).status).toBe(200)
  })

  it('employee → 403', async () => {
    expect((await request(app).get('/api/dashboard').set('Cookie', employeeCookie)).status).toBe(403)
  })

  it('unauthenticated → 401', async () => {
    expect((await request(app).get('/api/dashboard')).status).toBe(401)
  })
})
