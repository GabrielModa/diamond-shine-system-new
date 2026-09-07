import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { assignedVisitFilter } from '../../../modules/execution/access'
import { syncBatchSchema, syncBootstrapQuerySchema } from '../../../modules/execution/schemas'
import { asInputJson } from '../../../modules/operations/json'
import { POST as startVisit } from '../visits/[id]/start/route'
import { PATCH as updateTask } from '../visits/[id]/tasks/[taskId]/route'
import { POST as createEvidence } from '../visits/[id]/evidence/route'
import { POST as createIncident } from '../visits/[id]/incidents/route'
import { POST as stopTime } from '../time-entries/[id]/stop/route'
import { POST as startTime } from '../time-entries/route'
import { POST as completeVisit } from '../visits/[id]/complete/route'
import { POST as createStockCount } from '../sites/[id]/stock-counts/route'

type SyncOperation = ReturnType<typeof syncBatchSchema.parse>['operations'][number]

const PROCESSING_MARKER = 'PROCESSING'
const PROCESSING_LEASE_MS = 10 * 60_000

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function operationMatches(existing: {
  userId: string
  deviceId: string
  mutationType: string
  entityId: string | null
  payload: Prisma.JsonValue
  clientCreatedAt: Date
}, userId: string, deviceId: string, operation: SyncOperation) {
  return existing.userId === userId
    && existing.deviceId === deviceId
    && existing.mutationType === operation.type
    && existing.entityId === operation.entityId
    && existing.clientCreatedAt.getTime() === operation.clientCreatedAt.getTime()
    && canonicalJson(existing.payload) === canonicalJson(operation.payload)
}

type MutationClaim =
  | { kind: 'claimed' }
  | { kind: 'duplicate'; data: Prisma.JsonValue | null; error: string | null }
  | { kind: 'conflict'; error: string }

async function claimOfflineMutation(
  organizationId: string,
  userId: string,
  deviceId: string,
  operation: SyncOperation,
): Promise<MutationClaim> {
  const uniqueWhere = {
    organizationId_clientMutationId: { organizationId, clientMutationId: operation.clientMutationId },
  }

  try {
    await prisma.offlineMutation.create({
      data: {
        organizationId,
        userId,
        clientMutationId: operation.clientMutationId,
        deviceId,
        mutationType: operation.type,
        entityId: operation.entityId,
        payload: asInputJson(JSON.parse(JSON.stringify(operation.payload)))!,
        status: 'failed',
        error: PROCESSING_MARKER,
        clientCreatedAt: operation.clientCreatedAt,
      },
    })
    return { kind: 'claimed' }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
  }

  const existing = await prisma.offlineMutation.findUnique({ where: uniqueWhere })
  if (!existing) return { kind: 'conflict', error: 'Mutation could not be claimed safely. Retry later.' }

  // A clientMutationId is private to the user/device that created it. Never
  // return another user's stored mutation result merely because the random ID
  // collided or was guessed inside the same organization.
  if (!operationMatches(existing, userId, deviceId, operation)) {
    return { kind: 'conflict', error: 'Mutation identifier is already in use.' }
  }
  if (existing.status === 'processed') {
    return { kind: 'duplicate', data: existing.result, error: existing.error }
  }
  if (existing.error === PROCESSING_MARKER) {
    const staleBefore = new Date(Date.now() - PROCESSING_LEASE_MS)
    if (existing.processedAt > staleBefore) {
      return { kind: 'conflict', error: 'Mutation is already being processed. Retry later.' }
    }
    const reclaimed = await prisma.offlineMutation.updateMany({
      where: {
        id: existing.id,
        userId,
        error: PROCESSING_MARKER,
        processedAt: { lte: staleBefore },
      },
      data: { status: 'failed', error: PROCESSING_MARKER, processedAt: new Date() },
    })
    return reclaimed.count === 1
      ? { kind: 'claimed' }
      : { kind: 'conflict', error: 'Mutation is already being processed. Retry later.' }
  }

  const claimed = await prisma.offlineMutation.updateMany({
    where: {
      id: existing.id,
      userId,
      status: { in: ['failed', 'conflicted'] },
      error: { not: PROCESSING_MARKER },
    },
    data: { status: 'failed', error: PROCESSING_MARKER, processedAt: new Date() },
  })
  return claimed.count === 1
    ? { kind: 'claimed' }
    : { kind: 'conflict', error: 'Mutation is already being processed. Retry later.' }
}

function replayRequest(parent: NextRequest, path: string, method: string, payload: Record<string, unknown>) {
  const headers = new Headers({ 'content-type': 'application/json' })
  const cookie = parent.headers.get('cookie')
  const authorization = parent.headers.get('authorization')
  if (cookie) headers.set('cookie', cookie)
  if (authorization) headers.set('authorization', authorization)
  return new NextRequest(new URL(path, parent.url), {
    method,
    headers,
    body: JSON.stringify(payload),
  })
}

async function resolveTaskResult(organizationId: string, visitId: string, payload: Record<string, unknown>) {
  if (typeof payload.taskResultId === 'string') {
    return prisma.visitTaskResult.findFirst({
      where: { id: payload.taskResultId, visitId, organizationId },
    })
  }
  if (typeof payload.versionTaskId === 'string') {
    return prisma.visitTaskResult.findFirst({
      where: { versionTaskId: payload.versionTaskId, visitId, organizationId },
    })
  }
  return null
}

async function dispatchOperation(
  request: NextRequest,
  organizationId: string,
  userId: string,
  deviceId: string,
  operation: SyncOperation
) {
  const payload = { ...operation.payload }
  if (operation.type === 'visit.start') {
    return startVisit(replayRequest(request, `/api/visits/${operation.entityId}/start`, 'POST', {
      ...payload,
      source: 'offline',
      capturedAt: payload.capturedAt ?? operation.clientCreatedAt,
      clientMutationId: operation.clientMutationId,
      deviceId,
    }), { params: Promise.resolve({ id: operation.entityId }) })
  }
  if (operation.type === 'visit.task.update') {
    const task = await resolveTaskResult(organizationId, operation.entityId, payload)
    if (!task) return NextResponse.json({ ok: false, error: 'Task result is not available for sync.', code: 'TASK_NOT_FOUND' }, { status: 409 })
    delete payload.taskResultId
    delete payload.versionTaskId
    return updateTask(replayRequest(request, `/api/visits/${operation.entityId}/tasks/${task.id}`, 'PATCH', payload), {
      params: Promise.resolve({ id: operation.entityId, taskId: task.id }),
    })
  }
  if (operation.type === 'visit.evidence.create') {
    if (payload.versionTaskId || payload.taskResultId) {
      const task = await resolveTaskResult(organizationId, operation.entityId, payload)
      if (!task) return NextResponse.json({ ok: false, error: 'Evidence task is not available for sync.', code: 'TASK_NOT_FOUND' }, { status: 409 })
      payload.taskResultId = task.id
      delete payload.versionTaskId
    }
    return createEvidence(replayRequest(request, `/api/visits/${operation.entityId}/evidence`, 'POST', payload), {
      params: Promise.resolve({ id: operation.entityId }),
    })
  }
  if (operation.type === 'visit.incident.create') {
    return createIncident(replayRequest(request, `/api/visits/${operation.entityId}/incidents`, 'POST', payload), {
      params: Promise.resolve({ id: operation.entityId }),
    })
  }
  if (operation.type === 'material.stock.count') {
    return createStockCount(replayRequest(request, `/api/sites/${operation.entityId}/stock-counts`, 'POST', payload), {
      params: Promise.resolve({ id: operation.entityId }),
    })
  }
  if (operation.type === 'time.start') {
    return startTime(replayRequest(request, '/api/time-entries', 'POST', {
      ...payload,
      kind: operation.entityId,
      source: 'offline',
      startedAt: payload.startedAt ?? operation.clientCreatedAt,
      capturedAt: payload.capturedAt ?? operation.clientCreatedAt,
      clientMutationId: operation.clientMutationId,
      deviceId,
    }))
  }
  if (operation.type === 'time.stop') {
    let timeEntryId = typeof payload.timeEntryId === 'string' ? payload.timeEntryId : operation.entityId
    if (typeof payload.startMutationId === 'string') {
      const entry = await prisma.timeEntry.findFirst({
        where: { organizationId, userId, clientMutationId: payload.startMutationId },
        select: { id: true },
      })
      if (!entry) return NextResponse.json({ ok: false, error: 'The offline start has not synced yet.', code: 'START_NOT_SYNCED' }, { status: 409 })
      timeEntryId = entry.id
    }
    delete payload.timeEntryId
    delete payload.startMutationId
    return stopTime(replayRequest(request, `/api/time-entries/${timeEntryId}/stop`, 'POST', {
      ...payload,
      source: 'offline',
      endedAt: payload.endedAt ?? operation.clientCreatedAt,
      clientMutationId: operation.clientMutationId,
      deviceId,
    }), { params: Promise.resolve({ id: timeEntryId }) })
  }
  return completeVisit(replayRequest(request, `/api/visits/${operation.entityId}/complete`, 'POST', {
    ...payload,
    source: 'offline',
    completedAt: payload.completedAt ?? operation.clientCreatedAt,
    clientMutationId: operation.clientMutationId,
    deviceId,
  }), { params: Promise.resolve({ id: operation.entityId }) })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'visits.execute')
  if ('response' in auth) return auth.response
  const parsed = syncBatchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid sync batch', details: parsed.error.flatten() }, { status: 400 })

  const results: Array<Record<string, unknown>> = []
  for (const operation of parsed.data.operations) {
    const claim = await claimOfflineMutation(
      auth.user.organizationId,
      auth.user.id,
      parsed.data.deviceId,
      operation,
    )
    if (claim.kind === 'duplicate') {
      results.push({
        clientMutationId: operation.clientMutationId,
        status: 'duplicate',
        httpStatus: 200,
        data: claim.data,
        error: claim.error,
      })
      continue
    }
    if (claim.kind === 'conflict') {
      results.push({
        clientMutationId: operation.clientMutationId,
        status: 'conflicted',
        httpStatus: 409,
        error: claim.error,
      })
      continue
    }

    try {
      const response = await dispatchOperation(
        request,
        auth.user.organizationId,
        auth.user.id,
        parsed.data.deviceId,
        operation,
      )
      const body = await response.json().catch(() => ({ ok: false, error: 'Invalid sync response' }))
      const status = response.ok ? 'processed' : response.status === 409 ? 'conflicted' : 'failed'
      const error = response.ok ? null : typeof body.error === 'string' ? body.error : 'Sync failed'
      await prisma.offlineMutation.update({
        where: {
          organizationId_clientMutationId: {
            organizationId: auth.user.organizationId,
            clientMutationId: operation.clientMutationId,
          },
        },
        data: { status, result: asInputJson(body), error, processedAt: new Date() },
      })
      results.push({ clientMutationId: operation.clientMutationId, status, httpStatus: response.status, data: body, error })
    } catch {
      await prisma.offlineMutation.update({
        where: {
          organizationId_clientMutationId: {
            organizationId: auth.user.organizationId,
            clientMutationId: operation.clientMutationId,
          },
        },
        data: { status: 'failed', error: 'SERVER_ERROR', processedAt: new Date() },
      })
      results.push({ clientMutationId: operation.clientMutationId, status: 'failed', httpStatus: 500, error: 'SERVER_ERROR' })
    }
  }

  const hasFailures = results.some((result) => result.status === 'failed' || result.status === 'conflicted')
  return NextResponse.json({
    ok: !hasFailures,
    serverTime: new Date().toISOString(),
    results,
  }, { status: hasFailures ? 207 : 200 })
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'visits.execute')
  if ('response' in auth) return auth.response
  const url = new URL(request.url)
  const parsed = syncBootstrapQuerySchema.safeParse({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid sync window', details: parsed.error.flatten() }, { status: 400 })
  const from = parsed.data.from ?? new Date(Date.now() - 24 * 60 * 60 * 1000)
  const to = parsed.data.to ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  if (to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ ok: false, error: 'Sync window cannot exceed 31 days.' }, { status: 400 })
  }

  const visits = await prisma.visit.findMany({
    where: {
      organizationId: auth.user.organizationId,
      scheduledStart: { gte: from, lte: to },
      ...assignedVisitFilter(auth.user),
      // Bootstrap reconciles completed offline work too. Keep assignment access
      // restrictions, but do not apply the mutation-only operational status gate.
      status: { notIn: ['cancelled', 'missed'] },
    },
    include: {
      site: { include: { client: true, areas: { orderBy: { sortOrder: 'asc' } } } },
      assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
      servicePlanVersion: { include: { tasks: { orderBy: { sortOrder: 'asc' } } } },
      taskResults: { include: { evidence: true, versionTask: true } },
      evidenceAssets: true,
      incidents: { orderBy: { createdAt: 'desc' } },
      timeEntries: {
        where: { userId: auth.user.id },
        include: { locationEvents: { orderBy: { capturedAt: 'asc' } } },
      },
    },
    orderBy: { scheduledStart: 'asc' },
  })
  const serverTime = new Date().toISOString()
  return NextResponse.json({
    ok: true,
    cursor: serverTime,
    serverTime,
    window: { from: from.toISOString(), to: to.toISOString() },
    data: visits,
  })
}
