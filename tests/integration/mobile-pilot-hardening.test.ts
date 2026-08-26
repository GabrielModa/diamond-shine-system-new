import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { removeEvidence } from '../../src/lib/evidence-storage'
import { cleanOperations, getAuthCookie, seedUsers } from './setup'

let app: ReturnType<typeof createServer>
let nextApp: ReturnType<typeof next>
let adminCookie: string
let employeeCookie: string
let employeeToken: string

beforeAll(async () => {
  process.env.NEXT_TEST_DIST_DIR = '.next-integration'
  nextApp = next({ dev: true, dir: process.cwd() })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()
  app = createServer((req, res) => handle(req, res, parse(req.url!, true)))
  await cleanOperations()
  await seedUsers()
  adminCookie = await getAuthCookie('admin@ds.ie')
  employeeCookie = await getAuthCookie('employee@ds.ie')
  const mobileLogin = await request(app).post('/api/auth/login').send({ email: 'employee@ds.ie', password: 'password123', mobile: true, deviceName: 'pilot-test' })
  employeeToken = mobileLogin.body.data.accessToken
})

beforeEach(() => cleanOperations())
afterAll(async () => { await cleanOperations(); await prisma.mobileSession.deleteMany(); await nextApp.close() })

async function createAssignedVisit() {
  const client = (await request(app).post('/api/clients').set('Cookie', adminCookie).send({ displayName: 'Mobile Pilot Client' })).body.data
  const site = (await request(app).post('/api/sites').set('Cookie', adminCookie).send({
    clientId: client.id,
    name: 'Mobile Pilot Site',
    addressLine1: '1 Pilot Street',
    city: 'Dublin',
    postalCode: 'D01 MOB',
    latitude: 53.3498,
    longitude: -6.2603,
    areas: [{ name: 'Office', type: 'zone' }],
  })).body.data
  const plan = (await request(app).post('/api/service-plans').set('Cookie', adminCookie).send({
    siteId: site.id,
    name: 'Mobile Pilot Plan',
    expectedDurationMinutes: 60,
    requiredWorkers: 1,
    tasks: [{
      areaId: site.areas[0].id,
      title: 'Clean office',
      responseType: 'done_na_problem',
      required: true,
      evidenceRequired: true,
      evidenceVisibility: 'client_safe',
    }],
  })).body.data
  await request(app).post(`/api/service-plans/${plan.id}/publish`).set('Cookie', adminCookie)
  const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
  const job = (await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
    servicePlanId: plan.id,
    name: 'Mobile Pilot Job',
    startAt: '2026-08-26T09:00:00.000Z',
    recurrence: { frequency: 'once' },
    assigneeIds: [employee.id],
  })).body.data
  const visit = await prisma.visit.findFirstOrThrow({ where: { jobId: job.id } })
  const versionTask = await prisma.servicePlanVersionTask.findFirstOrThrow({ where: { versionId: visit.servicePlanVersionId } })
  return { visit, versionTask }
}

describe('mobile pilot hardening', () => {
  it('returns authoritative membership role and operational timezone to mobile sessions', async () => {
    const login = await request(app).post('/api/auth/login').send({
      email: 'employee@ds.ie',
      password: 'password123',
      mobile: true,
      deviceName: 'android-pilot',
    })
    expect(login.status).toBe(200)
    expect(login.body.data).toEqual(expect.objectContaining({
      role: 'employee',
      membershipRole: 'employee',
        organizationId: 'org_legacy_diamond_shine',
    }))
    expect(login.body.data.accessToken).toBeTruthy()
  })

  it('hydrates sync task results with version-task metadata required by the offline checklist', async () => {
    const { visit } = await createAssignedVisit()
    const started = await request(app).post(`/api/visits/${visit.id}/start`).set('Cookie', employeeCookie).send({
      latitude: 53.3498,
      longitude: -6.2603,
    })
    expect(started.status).toBe(201)

    const sync = await request(app)
      .get('/api/sync?from=2026-08-25T00:00:00.000Z&to=2026-08-28T00:00:00.000Z')
      .set('Authorization', `Bearer ${employeeToken}`)
    expect(sync.status).toBe(200)
    expect(sync.body.data).toHaveLength(1)
    expect(sync.body.data[0].taskResults).toHaveLength(1)
    expect(sync.body.data[0].taskResults[0].versionTask).toEqual(expect.objectContaining({ title: 'Clean office', required: true, evidenceRequired: true }))
  })

  it('accepts binary evidence by versionTaskId after an offline start has created the real task result', async () => {
    const { visit, versionTask } = await createAssignedVisit()
    const started = await request(app).post(`/api/visits/${visit.id}/start`).set('Cookie', employeeCookie).send({
      clientMutationId: 'mobile-offline-start-0001',
      deviceId: 'mobile-hardening-device',
      capturedAt: '2026-08-26T09:00:00.000Z',
    })
    expect(started.status).toBe(201)

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
    const uploaded = await request(app)
      .post(`/api/visits/${visit.id}/evidence-upload`)
      .set('Cookie', employeeCookie)
      .field('versionTaskId', versionTask.id)
      .field('phase', 'task')
      .field('visibility', 'client_safe')
      .attach('file', png, { filename: 'proof.png', contentType: 'image/png' })

    expect(uploaded.status).toBe(201)
    const result = await prisma.visitTaskResult.findFirstOrThrow({ where: { visitId: visit.id, versionTaskId: versionTask.id } })
    expect(uploaded.body.data.taskResultId).toBe(result.id)
    await removeEvidence(uploaded.body.data.storageKey)
  })
})
