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
afterAll(async () => { await cleanOperations(); await nextApp.close() })

async function executionVisit(options: { evidence?: boolean; assigned?: boolean } = {}) {
  const client = (await request(app).post('/api/clients').set('Cookie', adminCookie).send({ displayName: 'Execution Client' })).body.data
  const site = (await request(app).post('/api/sites').set('Cookie', adminCookie).send({
    clientId: client.id,
    name: 'Execution Site',
    addressLine1: '1 Verified Street',
    city: 'Dublin',
    postalCode: 'D01 EXEC',
    latitude: 53.3498,
    longitude: -6.2603,
    geofenceVerifiedM: 150,
    geofenceNearM: 250,
    geofenceSuspiciousM: 700,
    areas: [{ name: 'Office', type: 'zone' }],
  })).body.data
  let evidencePolicyId: string | undefined
  if (options.evidence) {
    evidencePolicyId = (await request(app).post('/api/evidence-policies').set('Cookie', adminCookie).send({
      name: 'Proof of service',
      requireFinishPhoto: true,
      minimumPhotoCount: 1,
    })).body.data.id
  }
  const plan = (await request(app).post('/api/service-plans').set('Cookie', adminCookie).send({
    siteId: site.id,
    evidencePolicyId,
    name: 'Execution Plan',
    expectedDurationMinutes: 60,
    requiredWorkers: 1,
    tasks: [{
      areaId: site.areas[0].id,
      title: 'Clean and verify office',
      responseType: 'done_na_problem',
      required: true,
      evidenceRequired: options.evidence ?? false,
      evidenceVisibility: 'client_safe',
    }],
  })).body.data
  await request(app).post(`/api/service-plans/${plan.id}/publish`).set('Cookie', adminCookie)
  const employee = await prisma.user.findUniqueOrThrow({ where: { email: 'employee@ds.ie' } })
  const job = (await request(app).post('/api/jobs').set('Cookie', adminCookie).send({
    servicePlanId: plan.id,
    name: 'Execution job',
    startAt: '2026-08-24T08:00:00.000Z',
    recurrence: { frequency: 'once' },
    assigneeIds: options.assigned === false ? [] : [employee.id],
  })).body.data
  const visit = await prisma.visit.findFirstOrThrow({ where: { jobId: job.id } })
  return { visit, site, employee }
}

describe('field execution', () => {
  it('starts idempotently, prevents parallel timers, and stops with verified GPS', async () => {
    const first = await executionVisit()
    const started = await request(app).post(`/api/visits/${first.visit.id}/start`).set('Cookie', employeeCookie).send({
      latitude: 53.3498,
      longitude: -6.2603,
      accuracyM: 8,
      clientMutationId: 'start-mutation-0001',
      deviceId: 'test-device',
    })
    expect(started.status).toBe(201)
    expect(started.body.location.classification).toBe('verified')
    expect(await prisma.visitTaskResult.count({ where: { visitId: first.visit.id } })).toBe(1)

    const heartbeat = await request(app).post(`/api/time-entries/${started.body.data.id}/heartbeat`).set('Cookie', employeeCookie).send({
      latitude: 53.34981,
      longitude: -6.26031,
      accuracyM: 9,
    })
    expect(heartbeat.status).toBe(201)
    const throttledHeartbeat = await request(app).post(`/api/time-entries/${started.body.data.id}/heartbeat`).set('Cookie', employeeCookie).send({
      latitude: 53.34982,
      longitude: -6.26032,
    })
    expect(throttledHeartbeat.status).toBe(200)
    expect(throttledHeartbeat.body.ignored).toBe(true)

    const duplicate = await request(app).post(`/api/visits/${first.visit.id}/start`).set('Cookie', employeeCookie).send({
      latitude: 53.3498,
      longitude: -6.2603,
      clientMutationId: 'start-mutation-0001',
      deviceId: 'test-device',
    })
    expect(duplicate.status).toBe(200)
    expect(duplicate.body.duplicate).toBe(true)

    const second = await executionVisit()
    const conflict = await request(app).post(`/api/visits/${second.visit.id}/start`).set('Cookie', employeeCookie).send({ latitude: 53.3498, longitude: -6.2603 })
    expect(conflict.status).toBe(409)
    expect(conflict.body.code).toBe('ACTIVE_TIMER')

    const stopped = await request(app).post(`/api/time-entries/${started.body.data.id}/stop`).set('Cookie', employeeCookie).send({
      latitude: 53.3498,
      longitude: -6.2603,
    })
    expect(stopped.status).toBe(200)
    expect(stopped.body.data.status).toBe('completed')
  })

  it('records distant or unavailable GPS without blocking the work', async () => {
    const { visit } = await executionVisit()
    const started = await request(app).post(`/api/visits/${visit.id}/start`).set('Cookie', employeeCookie).send({
      latitude: 53.45,
      longitude: -6.45,
    })
    expect(started.status).toBe(201)
    expect(started.body.location.classification).toBe('suspicious')
    expect(started.body.warning).toBe('LOCATION_FAR_FROM_SITE')

    const stopped = await request(app).post(`/api/time-entries/${started.body.data.id}/stop`).set('Cookie', employeeCookie).send({})
    expect(stopped.status).toBe(200)
    expect(stopped.body.data.status).toBe('needs_review')
    expect(stopped.body.data.reviewReason).toContain('GPS_UNAVAILABLE')

    const queue = await request(app).get('/api/time-entries?status=needs_review').set('Cookie', adminCookie)
    expect(queue.status).toBe(200)
    expect(queue.body.data).toHaveLength(1)
    const control = await request(app).get('/api/field-control?from=2026-08-23&to=2026-08-25').set('Cookie', adminCookie)
    expect(control.status).toBe(200)
    expect(control.body.data.summary.needsReview).toBe(1)
    const approved = await request(app).patch(`/api/time-entries/${started.body.data.id}/review`).set('Cookie', adminCookie).send({ decision: 'approved', note: 'Confirmed with site supervisor' })
    expect(approved.status).toBe(200)
    expect(approved.body.data.status).toBe('approved')
  })

  it('blocks completion until required tasks and evidence are genuinely complete', async () => {
    const { visit } = await executionVisit({ evidence: true })
    await request(app).post(`/api/visits/${visit.id}/start`).set('Cookie', employeeCookie).send({ latitude: 53.3498, longitude: -6.2603 })
    const result = await prisma.visitTaskResult.findFirstOrThrow({ where: { visitId: visit.id } })
    const taskDone = await request(app).patch(`/api/visits/${visit.id}/tasks/${result.id}`).set('Cookie', employeeCookie).send({ version: result.version, status: 'done' })
    expect(taskDone.status).toBe(200)

    const blocked = await request(app).post(`/api/visits/${visit.id}/complete`).set('Cookie', employeeCookie).send({ latitude: 53.3498, longitude: -6.2603 })
    expect(blocked.status).toBe(409)
    expect(blocked.body.blockers.map((item: { code: string }) => item.code)).toEqual(expect.arrayContaining(['TASK_EVIDENCE_REQUIRED', 'FINISH_PHOTO_REQUIRED']))

    const evidence = await request(app).post(`/api/visits/${visit.id}/evidence`).set('Cookie', employeeCookie).send({
      taskResultId: result.id,
      kind: 'photo',
      storageKey: `visits/${visit.id}/finish.jpg`,
      fileName: 'finish.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      visibility: 'client_safe',
      metadata: { phase: 'finish' },
    })
    expect(evidence.status).toBe(201)

    const completed = await request(app).post(`/api/visits/${visit.id}/complete`).set('Cookie', employeeCookie).send({ latitude: 53.3498, longitude: -6.2603 })
    expect(completed.status).toBe(200)
    expect(completed.body.data.status).toBe('completed')
  })

  it('turns critical incidents into explicit completion blockers and protects unassigned work', async () => {
    const unassigned = await executionVisit({ assigned: false })
    const forbidden = await request(app).post(`/api/visits/${unassigned.visit.id}/start`).set('Cookie', employeeCookie).send({})
    expect(forbidden.status).toBe(404)

    const { visit } = await executionVisit()
    await request(app).post(`/api/visits/${visit.id}/start`).set('Cookie', employeeCookie).send({ latitude: 53.3498, longitude: -6.2603 })
    const result = await prisma.visitTaskResult.findFirstOrThrow({ where: { visitId: visit.id } })
    await request(app).patch(`/api/visits/${visit.id}/tasks/${result.id}`).set('Cookie', employeeCookie).send({ version: result.version, status: 'done' })
    const incident = await request(app).post(`/api/visits/${visit.id}/incidents`).set('Cookie', employeeCookie).send({
      category: 'security',
      severity: 'critical',
      title: 'Alarm cannot be armed',
      description: 'The alarm panel reports a persistent fault.',
    })
    expect(incident.status).toBe(201)
    const blocked = await request(app).post(`/api/visits/${visit.id}/complete`).set('Cookie', employeeCookie).send({})
    expect(blocked.status).toBe(409)
    expect(blocked.body.blockers).toContainEqual(expect.objectContaining({ code: 'CRITICAL_INCIDENT_OPEN' }))
    const resolved = await request(app).patch(`/api/incidents/${incident.body.data.id}`).set('Cookie', adminCookie).send({
      status: 'resolved',
      resolution: 'Panel reset and armed by the site contact.',
    })
    expect(resolved.status).toBe(200)
    const completed = await request(app).post(`/api/visits/${visit.id}/complete`).set('Cookie', employeeCookie).send({})
    expect(completed.status).toBe(200)
  })

  it('replays an ordered offline visit safely and returns a complete mobile snapshot', async () => {
    const { visit } = await executionVisit()
    const versionTask = await prisma.servicePlanVersionTask.findFirstOrThrow({
      where: { versionId: visit.servicePlanVersionId },
    })
    const operations = [
      {
        clientMutationId: 'offline-start-0001',
        type: 'visit.start',
        entityId: visit.id,
        clientCreatedAt: '2026-08-24T08:00:00.000Z',
        payload: { latitude: 53.3498, longitude: -6.2603, accuracyM: 7 },
      },
      {
        clientMutationId: 'offline-task-0001',
        type: 'visit.task.update',
        entityId: visit.id,
        clientCreatedAt: '2026-08-24T08:20:00.000Z',
        payload: { versionTaskId: versionTask.id, version: 1, status: 'done' },
      },
      {
        clientMutationId: 'offline-stop-0001',
        type: 'time.stop',
        entityId: visit.id,
        clientCreatedAt: '2026-08-24T09:00:00.000Z',
        payload: { startMutationId: 'offline-start-0001', latitude: 53.3498, longitude: -6.2603 },
      },
      {
        clientMutationId: 'offline-complete-0001',
        type: 'visit.complete',
        entityId: visit.id,
        clientCreatedAt: '2026-08-24T09:01:00.000Z',
        payload: { latitude: 53.3498, longitude: -6.2603 },
      },
    ]

    const synced = await request(app).post('/api/sync').set('Cookie', employeeCookie).send({
      deviceId: 'integration-device',
      operations,
    })
    expect(synced.status).toBe(200)
    expect(synced.body.results.map((result: { status: string }) => result.status)).toEqual([
      'processed', 'processed', 'processed', 'processed',
    ])
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: visit.id } })).status).toBe('completed')
    expect(await prisma.timeEntry.count({ where: { visitId: visit.id } })).toBe(1)

    const duplicate = await request(app).post('/api/sync').set('Cookie', employeeCookie).send({
      deviceId: 'integration-device',
      operations,
    })
    expect(duplicate.status).toBe(200)
    expect(duplicate.body.results.every((result: { status: string }) => result.status === 'duplicate')).toBe(true)
    expect(await prisma.timeEntry.count({ where: { visitId: visit.id } })).toBe(1)

    const bootstrap = await request(app)
      .get('/api/sync?from=2026-08-23T00:00:00.000Z&to=2026-08-25T00:00:00.000Z')
      .set('Cookie', employeeCookie)
    expect(bootstrap.status).toBe(200)
    expect(bootstrap.body.data).toHaveLength(1)
    expect(bootstrap.body.data[0].taskResults[0].status).toBe('done')
    expect(bootstrap.body.data[0].timeEntries[0].locationEvents).toHaveLength(2)
  })
})
