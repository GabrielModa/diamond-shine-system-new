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
let supervisorCookie: string
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
  supervisorCookie = await getAuthCookie('super@ds.ie')
  employeeCookie = await getAuthCookie('employee@ds.ie')
  const mobileLogin = await request(app).post('/api/auth/login').send({ email: 'employee@ds.ie', password: 'password123', mobile: true })
  employeeToken = mobileLogin.body.data.accessToken
})
beforeEach(() => cleanOperations())
afterAll(async () => { await cleanOperations(); await nextApp.close() })

async function executionVisit(options: { evidence?: boolean; assigned?: boolean; startAt?: string } = {}) {
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
    startAt: options.startAt ?? '2026-08-24T08:00:00.000Z',
    recurrence: { frequency: 'once' },
    assigneeIds: options.assigned === false ? [] : [employee.id],
  })).body.data
  const visit = await prisma.visit.findFirstOrThrow({ where: { jobId: job.id } })
  return { visit, site, employee }
}

describe('field execution', () => {
  it('tracks non-visit work and breaks online or through the offline queue', async () => {
    const started = await request(app).post('/api/time-entries').set('Cookie', employeeCookie).send({
      kind: 'office',
      startedAt: '2026-08-24T07:00:00.000Z',
      latitude: 53.3498,
      longitude: -6.2603,
      clientMutationId: 'general-start-online-0001',
    })
    expect(started.status).toBe(201)
    expect(started.body.data).toEqual(expect.objectContaining({ kind: 'office', status: 'running' }))
    expect(started.body.data.locationEvents).toHaveLength(1)

    const duplicate = await request(app).post('/api/time-entries').set('Cookie', employeeCookie).send({
      kind: 'office', clientMutationId: 'general-start-online-0001',
    })
    expect(duplicate.status).toBe(200)
    expect(duplicate.body.duplicate).toBe(true)

    const parallel = await request(app).post('/api/time-entries').set('Cookie', employeeCookie).send({ kind: 'break' })
    expect(parallel.status).toBe(409)
    expect(parallel.body.code).toBe('TIMER_ALREADY_RUNNING')
    expect((await request(app).post(`/api/time-entries/${started.body.data.id}/stop`).set('Cookie', employeeCookie).send({ endedAt: '2026-08-24T07:30:00.000Z' })).status).toBe(200)

    const synced = await request(app).post('/api/sync').set('Cookie', employeeCookie).send({
      deviceId: 'offline-timesheet-device',
      operations: [
        { clientMutationId: 'general-start-offline-0001', type: 'time.start', entityId: 'break', clientCreatedAt: '2026-08-24T08:00:00.000Z', payload: {} },
        { clientMutationId: 'general-stop-offline-0001', type: 'time.stop', entityId: 'general-start-offline-0001', clientCreatedAt: '2026-08-24T08:15:00.000Z', payload: { startMutationId: 'general-start-offline-0001' } },
      ],
    })
    expect(synced.status).toBe(200)
    expect(synced.body.results.map((result: { status: string }) => result.status)).toEqual(['processed', 'processed'])

    const mine = await request(app).get('/api/time-entries?mine=true&from=2026-08-24&to=2026-08-25').set('Cookie', employeeCookie)
    expect(mine.status).toBe(200)
    expect(mine.body.data.map((entry: { kind: string }) => entry.kind).sort()).toEqual(['break', 'office'])
    expect(mine.body.data.every((entry: { status: string }) => entry.status === 'completed')).toBe(true)
  })

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

    const second = await executionVisit({ startAt: '2026-08-24T10:00:00.000Z' })
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
      capturedAt: '2026-08-24T08:00:00.000Z',
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

  it('lets a worker review a minimized location history and request a fair correction', async () => {
    const started = await request(app).post('/api/time-entries').set('Cookie', employeeCookie).send({
      kind: 'office', startedAt: '2026-08-24T07:00:00.000Z', latitude: 53.3498, longitude: -6.2603,
    })
    expect(started.status).toBe(201)
    await request(app).post(`/api/time-entries/${started.body.data.id}/stop`).set('Cookie', employeeCookie).send({ endedAt: '2026-08-24T07:15:00.000Z' })
    const mine = await request(app).get('/api/time-entries?mine=true&from=2026-08-24&to=2026-08-25').set('Cookie', employeeCookie)
    expect(mine.status).toBe(200)
    expect(mine.body.data[0].locationEvents[0]).not.toHaveProperty('latitude')
    const dispute = await request(app).post(`/api/time-entries/${started.body.data.id}/disputes`).set('Cookie', employeeCookie).send({ reason: 'The reading was taken at the site entrance, not away from work.' })
    expect(dispute.status).toBe(201)
    expect(dispute.body.data.status).toBe('open')
    const forbidden = await request(app).post(`/api/time-entries/${started.body.data.id}/disputes`).set('Cookie', adminCookie).send({ reason: 'Trying to submit a correction for someone else.' })
    expect(forbidden.status).toBe(403)
    const resolved = await request(app).patch(`/api/time-entry-disputes/${dispute.body.data.id}`).set('Cookie', adminCookie).send({ decision: 'accepted', resolution: 'Confirmed against the supervisor record.' })
    expect(resolved.status).toBe(200)
    expect(resolved.body.data.status).toBe('accepted')
  })

  it('keeps the original completion when a supervisor sends visit evidence back for rework', async () => {
    const { visit } = await executionVisit()
    const started = await request(app).post(`/api/visits/${visit.id}/start`).set('Cookie', employeeCookie).send({ latitude: 53.3498, longitude: -6.2603 })
    const result = await prisma.visitTaskResult.findFirstOrThrow({ where: { visitId: visit.id } })
    expect((await request(app).patch(`/api/visits/${visit.id}/tasks/${result.id}`).set('Cookie', employeeCookie).send({ version: result.version, status: 'done' })).status).toBe(200)
    expect((await request(app).post(`/api/visits/${visit.id}/complete`).set('Cookie', employeeCookie).send({ latitude: 53.3498, longitude: -6.2603 })).status).toBe(200)
    const rework = await request(app).post(`/api/visits/${visit.id}/review`).set('Cookie', adminCookie).send({ decision: 'rework_requested', note: 'Please add a final photo of the reception area.' })
    expect(rework.status).toBe(200)
    expect(rework.body.rework).toBe(true)
    const detail = await request(app).get(`/api/visits/${visit.id}`).set('Cookie', adminCookie)
    expect(detail.body.data.status).toBe('in_progress')
    expect(detail.body.data.completedAt).toBeTruthy()
    expect(detail.body.data.reopenedAt).toBeTruthy()
    expect(detail.body.data.reviews[0]).toEqual(expect.objectContaining({ decision: 'rework_requested' }))
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

  it('turns a site stock count into one actionable replenishment request', async () => {
    const { visit, site } = await executionVisit()
    const catalog = await request(app).get('/api/materials/catalog').set('Cookie', employeeCookie)
    expect(catalog.status).toBe(200)
    expect(catalog.body.data.length).toBeGreaterThan(2)
    const [emptyItem, healthyItem] = catalog.body.data

    const counted = await request(app)
      .post(`/api/sites/${site.id}/stock-counts`)
      .set('Cookie', employeeCookie)
      .send({
        visitId: visit.id,
        source: 'visit',
        lines: [
          { catalogItemId: emptyItem.id, quantity: 0, note: 'Empty dispenser and no reserve stock' },
          { catalogItemId: healthyItem.id, quantity: 10 },
        ],
      })
    expect(counted.status).toBe(201)
    expect(counted.body.data.replenishment.priority).toBe('urgent')
    expect(counted.body.data.replenishment.items[0]).toEqual(expect.objectContaining({
      catalogItemId: emptyItem.id,
      currentQuantity: 0,
      targetQuantity: 10,
      quantity: 10,
    }))

    const repeated = await request(app)
      .post(`/api/sites/${site.id}/stock-counts`)
      .set('Cookie', employeeCookie)
      .send({ visitId: visit.id, lines: [{ catalogItemId: emptyItem.id, quantity: 0 }] })
    expect(repeated.status).toBe(201)
    expect(repeated.body.data.replenishment).toBeNull()
    expect(await prisma.supplyRequest.count({ where: { siteId: site.id } })).toBe(1)

    const stock = await request(app).get(`/api/sites/${site.id}/stock`).set('Cookie', employeeCookie)
    expect(stock.status).toBe(200)
    expect(stock.body.data.find((item: { id: string }) => item.id === emptyItem.id).state).toBe('out')
    const offlineCount = await request(app).post('/api/sync').set('Cookie', employeeCookie).send({
      deviceId: 'offline-stock-device',
      operations: [{
        clientMutationId: 'offline-stock-count-0001',
        type: 'material.stock.count',
        entityId: site.id,
        clientCreatedAt: '2026-08-24T10:00:00.000Z',
        payload: { visitId: visit.id, source: 'visit', lines: [{ catalogItemId: healthyItem.id, quantity: 8 }] },
      }],
    })
    expect(offlineCount.status).toBe(200)
    expect(offlineCount.body.results[0].status).toBe('processed')
    expect((await prisma.siteStockLevel.findUniqueOrThrow({ where: { siteId_catalogItemId: { siteId: site.id, catalogItemId: healthyItem.id } } })).onHand).toBe(8)
    const control = await request(app).get('/api/materials/control').set('Cookie', adminCookie)
    expect(control.status).toBe(200)
    expect(control.body.data.summary).toEqual(expect.objectContaining({ outOfStock: 1, openRequests: 1 }))
  })

  it('turns a failed quality inspection into owned corrective work and verified closure', async () => {
    const { visit, site } = await executionVisit()
    const inspection = await request(app).post('/api/quality/inspections').set('Cookie', adminCookie).send({
      siteId: site.id,
      visitId: visit.id,
      type: 'spot_check',
      summary: 'Post-service quality review',
      clientVisible: true,
      items: [
        { category: 'Hygiene', title: 'Washrooms meet standard', weight: 4, critical: true, result: 'fail', finding: 'Soap residue on basins' },
        { category: 'Presentation', title: 'Bins and liners are ready', weight: 1, critical: false, result: 'pass' },
      ],
    })
    expect(inspection.status).toBe(201)
    expect(inspection.body.data.score).toBe(20)
    expect(inspection.body.data.passed).toBe(false)
    expect(inspection.body.data.actions).toHaveLength(1)
    expect(inspection.body.data.actions[0].severity).toBe('critical')

    const clientReport = await request(app).get(`/api/quality/inspections/${inspection.body.data.id}/client-report`).set('Cookie', adminCookie)
    expect(clientReport.status).toBe(200)
    expect(clientReport.body.data).toEqual(expect.objectContaining({
      client: site.client.displayName,
      site: site.name,
      score: 20,
      status: 'follow_up_in_progress',
    }))
    expect(JSON.stringify(clientReport.body.data)).not.toContain('employee@ds.ie')

    let action = inspection.body.data.actions[0]
    const accepted = await request(app).patch(`/api/quality/actions/${action.id}`).set('Cookie', adminCookie).send({
      status: 'accepted', version: action.version,
    })
    expect(accepted.status).toBe(200)
    action = accepted.body.data
    const resolved = await request(app).patch(`/api/quality/actions/${action.id}`).set('Cookie', adminCookie).send({
      status: 'resolved', version: action.version, resolutionNote: 'Basins recleaned and supervisor photo reviewed.',
    })
    expect(resolved.status).toBe(200)
    action = resolved.body.data
    const verified = await request(app).patch(`/api/quality/actions/${action.id}`).set('Cookie', adminCookie).send({
      status: 'verified', version: action.version, resolutionNote: 'Spot check passed after correction.',
    })
    expect(verified.status).toBe(200)
    expect((await prisma.qualityInspection.findUniqueOrThrow({ where: { id: inspection.body.data.id } })).status).toBe('closed')

    const control = await request(app).get('/api/quality/control').set('Cookie', adminCookie)
    expect(control.status).toBe(200)
    expect(control.body.data.summary).toEqual(expect.objectContaining({ inspections: 1, openActions: 0, criticalActions: 0 }))
  })

  it('delivers operational notices with individual read and acknowledgement receipts', async () => {
    const { visit, site, employee } = await executionVisit()
    const registration = await request(app).post('/api/devices/push-token').set('Cookie', employeeCookie).send({
      token: 'ExponentPushToken[integration-device-token]',
      platform: 'android',
      deviceId: 'integration-phone',
    })
    expect(registration.status).toBe(201)
    const published = await request(app).post('/api/operational-notices').set('Cookie', supervisorCookie).send({
      siteId: site.id,
      visitId: visit.id,
      type: 'schedule_change',
      priority: 'high',
      title: 'Visit moved to the morning',
      body: 'Please confirm the new arrival window before starting the visit.',
      requiresAcknowledgement: true,
      userIds: [employee.id],
    })
    expect(published.status).toBe(201)
    expect(published.body.data.recipients).toHaveLength(1)
    expect(await prisma.notificationJob.count({
      where: { kind: 'operational_notice_push', entityId: published.body.data.id, status: 'queued' },
    })).toBe(1)

    const inbox = await request(app).get('/api/operational-notices?scope=mine').set('Cookie', employeeCookie)
    expect(inbox.status).toBe(200)
    expect(inbox.body.data.summary).toEqual(expect.objectContaining({ total: 2, unread: 2, awaitingAcknowledgement: 2 }))
    const publishedInboxItem = inbox.body.data.items.find((item: { id: string }) => item.id === published.body.data.id)
    expect(publishedInboxItem).toEqual(expect.objectContaining({
      title: 'Visit moved to the morning',
      priority: 'high',
      requiresAcknowledgement: true,
    }))

    const acknowledged = await request(app)
      .patch(`/api/operational-notices/${published.body.data.id}/receipt`)
      .set('Cookie', employeeCookie)
      .send({ action: 'acknowledged', acknowledgement: 'Seen and confirmed.' })
    expect(acknowledged.status).toBe(200)
    expect(acknowledged.body.data.seenAt).toBeTruthy()
    expect(acknowledged.body.data.acknowledgedAt).toBeTruthy()

    const tracking = await request(app).get('/api/operational-notices?scope=all').set('Cookie', adminCookie)
    expect(tracking.status).toBe(200)
    expect(tracking.body.data.summary).toEqual(expect.objectContaining({ recipients: 2, seen: 1, acknowledged: 1 }))
    const publishedTrackingItem = tracking.body.data.items.find((item: { id: string }) => item.id === published.body.data.id)
    expect(publishedTrackingItem?.recipients[0].acknowledgement).toBe('Seen and confirmed.')
  })

  it('supports secure bearer authentication for the native field app', async () => {
    expect(employeeToken).toBeTruthy()
    const response = await request(app)
      .get('/api/operational-notices?scope=mine')
      .set('Authorization', `Bearer ${employeeToken}`)
    expect(response.status).toBe(200)
    expect(response.body.ok).toBe(true)
  })

  it('accepts authenticated field photo evidence and links it to the checklist item', async () => {
    const { visit } = await executionVisit({ evidence: true })
    await request(app).post(`/api/visits/${visit.id}/start`).set('Cookie', employeeCookie).send({ latitude: 53.3498, longitude: -6.2603 })
    const task = await prisma.visitTaskResult.findFirstOrThrow({ where: { visitId: visit.id } })
    const spoofed = await request(app)
      .post(`/api/visits/${visit.id}/evidence-upload`)
      .set('Cookie', employeeCookie)
      .attach('file', Buffer.from('fake-jpeg-content'), { filename: 'spoofed.jpg', contentType: 'image/jpeg' })
    expect(spoofed.status).toBe(400)

    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9])
    const uploaded = await request(app)
      .post(`/api/visits/${visit.id}/evidence-upload`)
      .set('Cookie', employeeCookie)
      .field('taskResultId', task.id)
      .field('visibility', 'client_safe')
      .field('phase', 'task')
      .attach('file', jpegBytes, { filename: 'proof.jpg', contentType: 'image/jpeg' })
    expect(uploaded.status).toBe(201)
    expect(uploaded.body.data).toEqual(expect.objectContaining({ visitId: visit.id, taskResultId: task.id, kind: 'photo', visibility: 'client_safe' }))
    expect(await prisma.evidenceAsset.count({ where: { visitId: visit.id, taskResultId: task.id } })).toBe(1)
    const downloaded = await request(app)
      .get(`/api/evidence/${uploaded.body.data.id}`)
      .set('Cookie', employeeCookie)
      .buffer(true)
    expect(downloaded.status).toBe(200)
    expect(downloaded.headers['content-type']).toContain('image/jpeg')
    expect(downloaded.headers['cache-control']).toContain('no-store')
  })

  it('revokes a native session on logout', async () => {
    const before = await request(app)
      .get('/api/operational-notices?scope=mine')
      .set('Authorization', `Bearer ${employeeToken}`)
    expect(before.status).toBe(200)
    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${employeeToken}`)
    expect(logout.status).toBe(200)
    const after = await request(app)
      .get('/api/operational-notices?scope=mine')
      .set('Authorization', `Bearer ${employeeToken}`)
    expect(after.status).toBe(401)
  })
})
