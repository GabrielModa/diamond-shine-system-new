import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { createSessionToken } from '../../src/lib/session'
import { LEGACY_ORGANIZATION_ID } from '../../src/lib/tenancy'
import { cleanOperations, getAuthCookie, seedUsers } from './setup'

let app: ReturnType<typeof createServer>
let nextApp: ReturnType<typeof next>
let adminCookie: string
let employeeCookie: string

beforeAll(async () => {
  nextApp = next({ dev: true, dir: process.cwd() })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()
  app = createServer((req, res) => handle(req, res, parse(req.url!, true)))
  await cleanOperations()
  await seedUsers()
  adminCookie = await getAuthCookie('admin@ds.ie')
  employeeCookie = await getAuthCookie('employee@ds.ie')
})

beforeEach(() => cleanOperations())

afterAll(async () => {
  await cleanOperations()
  await nextApp.close()
})

async function createClient(cookie = adminCookie, displayName = 'Diamond Demo Client') {
  return request(app).post('/api/clients').set('Cookie', cookie).send({
    displayName,
    legalName: `${displayName} Limited`,
    type: 'commercial',
    billingEmail: 'facilities@example.ie',
    contacts: [{ name: 'Aoife Manager', role: 'Facilities Manager', email: 'aoife@example.ie', isPrimary: true }],
  })
}

async function createSite(clientId: string, cookie = adminCookie) {
  return request(app).post('/api/sites').set('Cookie', cookie).send({
    clientId,
    name: 'North Office',
    addressLine1: '2 Demo Avenue',
    city: 'Dublin',
    postalCode: 'D01 DEMO',
    countryCode: 'IE',
    timezone: 'Europe/Dublin',
    latitude: 53.3498,
    longitude: -6.2603,
    coordinateAccuracyM: 12,
    coordinateSource: 'gps_verified',
    geofenceVerifiedM: 150,
    geofenceNearM: 250,
    geofenceSuspiciousM: 700,
    access: {
      entryInstructions: 'Use the service entrance.',
      hazards: [{ label: 'Wet floor', severity: 'medium' }],
    },
    areas: [
      { name: 'Ground Floor', type: 'floor', sortOrder: 0 },
      { name: 'Kitchen', type: 'room', sortOrder: 1 },
    ],
  })
}

describe('cleaning domain foundation', () => {
  it('creates the client, site, contract and a versioned service plan', async () => {
    const clientResponse = await createClient()
    expect(clientResponse.status).toBe(201)
    const client = clientResponse.body.data

    const siteResponse = await createSite(client.id)
    expect(siteResponse.status).toBe(201)
    expect(siteResponse.body.data.areas).toHaveLength(2)
    const site = siteResponse.body.data

    const contractResponse = await request(app).post('/api/contracts').set('Cookie', adminCookie).send({
      clientId: client.id,
      name: 'Commercial Cleaning 2026',
      reference: 'DS-2026-001',
      status: 'active',
      startDate: '2026-08-22',
      currency: 'EUR',
      siteIds: [site.id],
      completionPolicy: { requireAllCriticalTasks: true },
    })
    expect(contractResponse.status).toBe(201)
    const contract = contractResponse.body.data

    const policyResponse = await request(app).post('/api/evidence-policies').set('Cookie', adminCookie).send({
      name: 'Critical proof',
      description: 'Require proof for critical tasks.',
      requireStartPhoto: true,
      requireEndPhoto: true,
      rules: { criticalTaskPhoto: true },
    })
    expect(policyResponse.status).toBe(201)

    const planResponse = await request(app).post('/api/service-plans').set('Cookie', adminCookie).send({
      contractId: contract.id,
      siteId: site.id,
      evidencePolicyId: policyResponse.body.data.id,
      name: 'North Office Standard Clean',
      expectedDurationMinutes: 180,
      requiredWorkers: 2,
      tasks: [
        { areaId: site.areas[0].id, title: 'Vacuum floors', responseType: 'done_na_problem', required: true, sortOrder: 0 },
        { areaId: site.areas[1].id, title: 'Check hand soap', responseType: 'stock_level', critical: true, evidenceRequired: true, sortOrder: 1 },
      ],
    })
    expect(planResponse.status).toBe(201)
    const plan = planResponse.body.data

    const publishV1 = await request(app).post(`/api/service-plans/${plan.id}/publish`).set('Cookie', adminCookie)
    expect(publishV1.status).toBe(201)
    expect(publishV1.body.data.versionNumber).toBe(1)
    expect(publishV1.body.data.tasks).toHaveLength(2)
    const v1Hash = publishV1.body.data.contentHash

    const idempotent = await request(app).post(`/api/service-plans/${plan.id}/publish`).set('Cookie', adminCookie)
    expect(idempotent.status).toBe(200)
    expect(idempotent.body.idempotent).toBe(true)
    expect(idempotent.body.data.contentHash).toBe(v1Hash)

    const update = await request(app).patch(`/api/service-plans/${plan.id}`).set('Cookie', adminCookie).send({
      version: plan.version,
      expectedDurationMinutes: 210,
      tasks: [
        { areaId: site.areas[0].id, title: 'Vacuum and inspect floors', responseType: 'done_na_problem', required: true, sortOrder: 0 },
      ],
    })
    expect(update.status).toBe(200)

    const publishV2 = await request(app).post(`/api/service-plans/${plan.id}/publish`).set('Cookie', adminCookie)
    expect(publishV2.status).toBe(201)
    expect(publishV2.body.data.versionNumber).toBe(2)
    expect(publishV2.body.data.contentHash).not.toBe(v1Hash)

    const persistedV1 = await prisma.servicePlanVersion.findFirstOrThrow({
      where: { servicePlanId: plan.id, versionNumber: 1 },
      include: { tasks: true },
    })
    expect(persistedV1.expectedDurationMinutes).toBe(180)
    expect(persistedV1.tasks).toHaveLength(2)
  })

  it('enforces ordered geofence bands', async () => {
    const client = (await createClient()).body.data
    const response = await request(app).post('/api/sites').set('Cookie', adminCookie).send({
      clientId: client.id,
      name: 'Invalid bands',
      addressLine1: '1 Test Street',
      city: 'Dublin',
      postalCode: 'D02 TEST',
      geofenceVerifiedM: 700,
      geofenceNearM: 250,
      geofenceSuspiciousM: 150,
    })
    expect(response.status).toBe(400)
  })

  it('prevents stale edits with optimistic version checks', async () => {
    const created = (await createClient()).body.data
    const first = await request(app).patch(`/api/clients/${created.id}`).set('Cookie', adminCookie).send({
      version: created.version,
      displayName: 'Updated once',
    })
    expect(first.status).toBe(200)
    const stale = await request(app).patch(`/api/clients/${created.id}`).set('Cookie', adminCookie).send({
      version: created.version,
      displayName: 'Stale update',
    })
    expect(stale.status).toBe(409)
  })

  it('allows field users to read operations but not manage them', async () => {
    const created = await createClient(employeeCookie, 'Unauthorized write')
    expect(created.status).toBe(403)
    expect((await request(app).get('/api/clients').set('Cookie', employeeCookie)).status).toBe(200)
  })

  it('isolates clients and rejects references from another organization', async () => {
    const organization = await prisma.organization.create({
      data: { name: 'Tenant B', slug: `tenant-b-${Date.now()}`, timezone: 'Europe/Dublin' },
    })
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@ds.ie' } })
    await prisma.membership.create({
      data: { organizationId: organization.id, userId: admin.id, role: 'organization_admin', status: 'active' },
    })
    const tenantBCookie = `ds-session=${await createSessionToken(admin.email, 'admin', organization.id)}`
    const tenantAClient = (await createClient()).body.data
    const tenantBClient = (await createClient(tenantBCookie, 'Tenant B Client')).body.data

    const tenantAList = await request(app).get('/api/clients').set('Cookie', adminCookie)
    const tenantBList = await request(app).get('/api/clients').set('Cookie', tenantBCookie)
    expect(tenantAList.body.data.map((client: { id: string }) => client.id)).toContain(tenantAClient.id)
    expect(tenantAList.body.data.map((client: { id: string }) => client.id)).not.toContain(tenantBClient.id)
    expect(tenantBList.body.data).toHaveLength(1)

    const crossTenantSite = await createSite(tenantBClient.id, adminCookie)
    expect(crossTenantSite.status).toBe(400)
    expect(await prisma.client.count({ where: { organizationId: LEGACY_ORGANIZATION_ID } })).toBe(1)
  })
})
