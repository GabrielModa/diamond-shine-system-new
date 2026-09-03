import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createServer } from 'node:http'
import { parse } from 'node:url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { cleanOperations, getAuthCookie, seedUsers } from './setup'

let app: ReturnType<typeof createServer>
let nextApp: ReturnType<typeof next>
let adminCookie: string
let employeeCookie: string

beforeAll(async () => {
  process.env.NEXT_TEST_DIST_DIR = '.next-integration'
  nextApp = next({ dev: true, dir: process.cwd() })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()
  app = createServer((req, res) => handle(req, res, parse(req.url!, true)))
  await seedUsers()
  adminCookie = await getAuthCookie('admin@ds.ie')
  employeeCookie = await getAuthCookie('employee@ds.ie')
}, 30_000)

beforeEach(() => cleanOperations())

afterAll(async () => {
  await cleanOperations()
  await nextApp.close()
})

async function createClient(displayName = 'Client account integration') {
  const response = await request(app).post('/api/clients').set('Cookie', adminCookie).send({
    displayName,
    type: 'commercial',
    contacts: [{ name: 'Primary contact', email: 'contact@example.ie', isPrimary: true }],
  })
  expect(response.status).toBe(201)
  return response.body.data as { id: string }
}

async function createSite(clientId: string, name = 'Verified service location') {
  const response = await request(app).post('/api/sites').set('Cookie', adminCookie).send({
    clientId,
    name,
    addressLine1: "Usher's Quay",
    city: 'Dublin 8',
    postalCode: 'D08 HV21',
    countryCode: 'IE',
    timezone: 'Europe/Dublin',
    latitude: 53.3451,
    longitude: -6.2811,
    coordinateSource: 'geocoded',
    geofenceVerifiedM: 150,
    geofenceNearM: 250,
    geofenceSuspiciousM: 700,
    access: { entryInstructions: 'Use reception.' },
    areas: [{ name: 'Main area', type: 'zone', sortOrder: 0 }],
  })
  expect(response.status).toBe(201)
  return response.body.data as { id: string }
}

function servicePayload(siteId: string, overrides: Record<string, unknown> = {}) {
  return {
    siteId,
    serviceName: 'Regular cleaning',
    startAt: '2026-09-08T09:00:00.000Z',
    endDate: '2026-12-08T09:00:00.000Z',
    expectedDurationMinutes: 120,
    requiredWorkers: 2,
    tasks: ['Vacuum floors', 'Clean bathrooms'],
    recurrence: { frequency: 'weekly', interval: 1, weekdays: [2] },
    instructions: 'Follow the client access notes.',
    ...overrides,
  }
}

describe('client account product flow', () => {
  it('returns the client with its verified service locations', async () => {
    const client = await createClient()
    const site = await createSite(client.id)

    const response = await request(app).get(`/api/client-accounts/${client.id}`).set('Cookie', adminCookie)
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
    expect(response.body.data.client.id).toBe(client.id)
    expect(response.body.data.client.sites).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: site.id, city: 'Dublin 8', postalCode: 'D08 HV21' }),
    ]))
    expect(response.body.data.upcomingVisits).toEqual([])
  })

  it('creates one service rule and materializes the recurring schedule coherently', async () => {
    const client = await createClient()
    const site = await createSite(client.id)

    const response = await request(app)
      .post(`/api/client-accounts/${client.id}/service`)
      .set('Cookie', adminCookie)
      .send(servicePayload(site.id))

    expect(response.status).toBe(201)
    expect(response.body.data.generatedVisits).toBeGreaterThan(0)
    expect(response.body.data.versionNumber).toBe(1)

    const plan = await prisma.servicePlan.findUniqueOrThrow({ where: { id: response.body.data.servicePlanId } })
    const job = await prisma.job.findUniqueOrThrow({ where: { id: response.body.data.jobId } })
    const visits = await prisma.visit.findMany({ where: { jobId: job.id }, orderBy: { scheduledStart: 'asc' } })
    expect(plan.status).toBe('published')
    expect(plan.requiredWorkers).toBe(2)
    expect(job.servicePlanId).toBe(plan.id)
    expect(visits).toHaveLength(response.body.data.generatedVisits)
    expect(visits.every((visit) => visit.requiredWorkers === 2)).toBe(true)

    const account = await request(app).get(`/api/client-accounts/${client.id}`).set('Cookie', adminCookie)
    const accountSite = account.body.data.client.sites.find((item: { id: string }) => item.id === site.id)
    expect(accountSite.servicePlans).toHaveLength(1)
    expect(accountSite.servicePlans[0].jobs).toHaveLength(1)
    expect(account.body.data.upcomingVisits.length).toBeGreaterThan(0)
  })

  it('does not create duplicate active services with the same name at one location', async () => {
    const client = await createClient()
    const site = await createSite(client.id)
    const first = await request(app).post(`/api/client-accounts/${client.id}/service`).set('Cookie', adminCookie).send(servicePayload(site.id))
    expect(first.status).toBe(201)

    const duplicate = await request(app).post(`/api/client-accounts/${client.id}/service`).set('Cookie', adminCookie).send(servicePayload(site.id))
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error).toMatch(/already exists/i)
    expect(await prisma.servicePlan.count({ where: { siteId: site.id, name: 'Regular cleaning' } })).toBe(1)
  })

  it('rejects impossible service dates before creating contract or schedule records', async () => {
    const client = await createClient()
    const site = await createSite(client.id)

    const response = await request(app)
      .post(`/api/client-accounts/${client.id}/service`)
      .set('Cookie', adminCookie)
      .send(servicePayload(site.id, { endDate: '2026-09-07T09:00:00.000Z' }))

    expect(response.status).toBe(400)
    expect(await prisma.contract.count({ where: { clientId: client.id } })).toBe(0)
    expect(await prisma.servicePlan.count({ where: { siteId: site.id } })).toBe(0)
    expect(await prisma.job.count({ where: { siteId: site.id } })).toBe(0)
  })

  it('rejects a service location that belongs to another client', async () => {
    const clientA = await createClient('Client A')
    const clientB = await createClient('Client B')
    const siteB = await createSite(clientB.id, 'Client B site')

    const response = await request(app)
      .post(`/api/client-accounts/${clientA.id}/service`)
      .set('Cookie', adminCookie)
      .send(servicePayload(siteB.id))

    expect(response.status).toBe(404)
    expect(response.body.error).toMatch(/not found/i)
  })

  it('keeps service setup manager-only', async () => {
    const client = await createClient()
    const site = await createSite(client.id)

    const response = await request(app)
      .post(`/api/client-accounts/${client.id}/service`)
      .set('Cookie', employeeCookie)
      .send(servicePayload(site.id))

    expect(response.status).toBe(403)
  })
})
