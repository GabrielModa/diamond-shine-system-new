import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { prisma } from '../../src/lib/prisma'
import { cleanOperations, getAuthCookie, seedUsers } from './setup'

let app: ReturnType<typeof createServer>
let nextApp: ReturnType<typeof next>
let adminCookie: string
let employeeCookie: string
let supervisorCookie: string

beforeAll(async () => {
  process.env.NEXT_TEST_DIST_DIR = '.next-integration'
  nextApp = next({ dev: true, dir: process.cwd() })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()
  app = createServer((req, res) => handle(req, res, parse(req.url!, true)))
  await seedUsers()
  adminCookie = await getAuthCookie('admin@ds.ie')
  employeeCookie = await getAuthCookie('employee@ds.ie')
  supervisorCookie = await getAuthCookie('super@ds.ie')
})

beforeEach(() => cleanOperations())
afterAll(async () => { await cleanOperations(); await nextApp.close() })

async function createAssignedVisit(label: string, assigneeId: string, startAt: string) {
  const client = (await request(app).post('/api/clients').set('Cookie', adminCookie).send({ displayName: `${label} Client` })).body.data
  const site = (await request(app).post('/api/sites').set('Cookie', adminCookie).send({
    clientId: client.id,
    name: `${label} Site`,
    addressLine1: `${label} Street`,
    city: 'Dublin',
    postalCode: 'D01 PERF',
    areas: [{ name: 'Office', type: 'zone' }],
  })).body.data
  const plan = (await request(app).post('/api/service-plans').set('Cookie', adminCookie).send({
    siteId: site.id,
    name: `${label} Plan`,
    expectedDurationMinutes: 60,
    requiredWorkers: 1,
    tasks: [{ areaId: site.areas[0].id, title: `${label} task`, responseType: 'done_na_problem', required: true }],
  })).body.data
  await request(app).post(`/api/service-plans/${plan.id}/publish`).set('Cookie', adminCookie)
  const job = (await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
    servicePlanId: plan.id,
    name: `${label} Job`,
    startAt,
    recurrence: { frequency: 'once' },
    assigneeIds: [assigneeId],
  })).body.data
  return prisma.visit.findFirstOrThrow({ where: { jobId: job.id } })
}

describe('mobile performance snapshots', () => {
  it('keeps personal tabs scoped to the signed-in user for cleaners and supervisors', async () => {
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const supervisor = await prisma.user.findUniqueOrThrow({ where: { email: 'super@ds.ie' } })
    const employeeVisit = await createAssignedVisit('Employee', employee.id, '2026-09-09T08:00:00.000Z')
    const supervisorVisit = await createAssignedVisit('Supervisor', supervisor.id, '2026-09-09T10:00:00.000Z')
    const window = '?from=2026-09-08T00:00:00.000Z&to=2026-09-12T00:00:00.000Z'

    const employeeSummary = await request(app).get(`/api/mobile/visit-summary${window}`).set('Cookie', employeeCookie)
    expect(employeeSummary.status).toBe(200)
    expect(employeeSummary.body.data.map((visit: { id: string }) => visit.id)).toEqual([employeeVisit.id])

    const supervisorSummary = await request(app).get(`/api/mobile/visit-summary${window}`).set('Cookie', supervisorCookie)
    expect(supervisorSummary.status).toBe(200)
    expect(supervisorSummary.body.data.map((visit: { id: string }) => visit.id)).toEqual([supervisorVisit.id])
  })

  it('keeps the hot-path summary small and the deferred offline pack execution-complete', async () => {
    const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
    const visit = await createAssignedVisit('Fast', employee.id, '2026-09-09T08:00:00.000Z')
    const window = '?from=2026-09-08T00:00:00.000Z&to=2026-09-12T00:00:00.000Z'

    const summary = await request(app).get(`/api/mobile/visit-summary${window}`).set('Cookie', employeeCookie)
    expect(summary.status).toBe(200)
    expect(summary.body.data).toHaveLength(1)
    expect(summary.body.data[0]).toEqual(expect.objectContaining({ id: visit.id }))
    expect(summary.body.data[0]).not.toHaveProperty('servicePlanVersion')
    expect(summary.body.data[0]).not.toHaveProperty('taskResults')
    expect(summary.body.data[0]).not.toHaveProperty('evidenceAssets')
    expect(summary.body.data[0]).not.toHaveProperty('incidents')
    expect(summary.body.data[0].assignments).toHaveLength(1)

    const pack = await request(app).get(`/api/mobile/offline-pack${window}`).set('Cookie', employeeCookie)
    expect(pack.status).toBe(200)
    expect(pack.body.data).toHaveLength(1)
    expect(pack.body.data[0].id).toBe(visit.id)
    expect(pack.body.data[0].servicePlanVersion.tasks).toHaveLength(1)
    expect(pack.body.data[0]).toHaveProperty('taskResults')
    expect(pack.body.data[0]).toHaveProperty('evidenceAssets')
    expect(pack.body.data[0]).toHaveProperty('incidents')
  })
})
