import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { enqueueNotification } from '../../../lib/notification-queue'
import { addOperationalDays, zonedDateTimeToUtc } from '../../../lib/operational-time'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../modules/scheduling/assignment-lifecycle'
import { generateOccurrences, generationKey } from '../../../modules/scheduling/recurrence'
import { recurrenceSchema, servicePauseCreateSchema } from '../../../modules/scheduling/schemas'

const CANCELLABLE = ['scheduled', 'dispatched', 'acknowledged'] as const

class PauseApplyConflict extends Error {
  constructor(
    readonly code: 'SERVICE_PAUSE_OVERLAP' | 'SERVICE_PAUSE_IN_PROGRESS' | 'SERVICE_PAUSE_CHANGED',
    message: string,
    readonly data: unknown,
  ) {
    super(message)
  }
}

function scopeVisitWhere(scope: 'client' | 'site' | 'job', targetId: string) {
  if (scope === 'client') return { site: { clientId: targetId } }
  if (scope === 'site') return { siteId: targetId }
  return { jobId: targetId }
}

function scopeJobWhere(scope: 'client' | 'site' | 'job', targetId: string) {
  if (scope === 'client') return { site: { clientId: targetId } }
  if (scope === 'site') return { siteId: targetId }
  return { id: targetId }
}

function pauseTargetWhere(
  scope: 'client' | 'site' | 'job',
  target: { clientId: string | null; siteId: string | null; jobId: string | null },
) {
  return scope === 'client'
    ? { scope: 'client' as const, clientId: target.clientId }
    : scope === 'site'
      ? { scope: 'site' as const, siteId: target.siteId }
      : { scope: 'job' as const, jobId: target.jobId }
}

async function resolveTarget(organizationId: string, scope: 'client' | 'site' | 'job', targetId: string) {
  if (scope === 'client') {
    const [client, organization] = await Promise.all([
      prisma.client.findFirst({ where: { id: targetId, organizationId, archivedAt: null }, select: { id: true, displayName: true } }),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    ])
    return client && organization ? { timezone: organization.timezone, clientId: client.id, siteId: null, jobId: null, label: client.displayName } : null
  }
  if (scope === 'site') {
    const site = await prisma.site.findFirst({
      where: { id: targetId, organizationId, archivedAt: null },
      select: { id: true, name: true, timezone: true, clientId: true, client: { select: { displayName: true } } },
    })
    return site ? { timezone: site.timezone, clientId: null, siteId: site.id, jobId: null, label: `${site.client.displayName} · ${site.name}` } : null
  }
  const job = await prisma.job.findFirst({
    where: { id: targetId, organizationId, archivedAt: null },
    select: { id: true, name: true, site: { select: { id: true, timezone: true, client: { select: { displayName: true } } } } },
  })
  return job ? { timezone: job.site.timezone, clientId: null, siteId: null, jobId: job.id, label: `${job.site.client.displayName} · ${job.name}` } : null
}

async function findOverlappingPause(
  db: Prisma.TransactionClient,
  input: {
    organizationId: string
    pauseTargetWhere: ReturnType<typeof pauseTargetWhere>
    startsAt: Date
    endsAt: Date
  },
) {
  const pauses = await db.servicePause.findMany({
    where: {
      organizationId: input.organizationId,
      ...input.pauseTargetWhere,
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
    },
    select: { id: true, startsAt: true, endsAt: true, endedEarlyAt: true },
  })
  return pauses.find((pause) => {
    const effectiveEnd = pause.endedEarlyAt && pause.endedEarlyAt < pause.endsAt ? pause.endedEarlyAt : pause.endsAt
    return effectiveEnd > input.startsAt
  }) ?? null
}

async function loadPauseImpact(
  db: Prisma.TransactionClient,
  input: {
    organizationId: string
    scope: 'client' | 'site' | 'job'
    targetId: string
    startsAt: Date
    endsAt: Date
  },
) {
  const visitWhere = scopeVisitWhere(input.scope, input.targetId)
  const jobWhere = scopeJobWhere(input.scope, input.targetId)

  const [affectedVisits, blockers, jobs] = await Promise.all([
    db.visit.findMany({
      where: {
        organizationId: input.organizationId,
        ...visitWhere,
        status: { in: [...CANCELLABLE] },
        scheduledStart: { lt: input.endsAt },
        scheduledEnd: { gt: input.startsAt },
      },
      include: {
        site: { select: { name: true, client: { select: { displayName: true } } } },
        assignments: {
          where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
      orderBy: { scheduledStart: 'asc' },
    }),
    db.visit.findMany({
      where: {
        organizationId: input.organizationId,
        ...visitWhere,
        status: 'in_progress',
        scheduledStart: { lt: input.endsAt },
        scheduledEnd: { gt: input.startsAt },
      },
      select: { id: true, scheduledStart: true, site: { select: { name: true, client: { select: { displayName: true } } } } },
    }),
    db.job.findMany({
      where: {
        organizationId: input.organizationId,
        archivedAt: null,
        status: { in: ['active', 'paused'] },
        ...jobWhere,
        startDate: { lt: input.endsAt },
        OR: [{ endDate: null }, { endDate: { gt: input.startsAt } }],
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        recurrence: true,
        timezone: true,
        defaultDurationMin: true,
        requiredWorkers: true,
      },
    }),
  ])

  const jobIds = jobs.map((job) => job.id)
  const existingKeys = jobIds.length ? await db.visit.findMany({
    where: {
      organizationId: input.organizationId,
      jobId: { in: jobIds },
      generationKey: { gte: input.startsAt.toISOString(), lt: input.endsAt.toISOString() },
    },
    select: { jobId: true, generationKey: true },
  }) : []
  const materializedKeys = new Set(existingKeys.map((visit) => `${visit.jobId}:${visit.generationKey}`))

  const obligations = new Map<string, { plannedMinutes: number }>()
  for (const visit of affectedVisits) {
    const durationMinutes = Math.max(0, (visit.scheduledEnd.getTime() - visit.scheduledStart.getTime()) / 60_000)
    obligations.set(`${visit.jobId}:${visit.generationKey}`, {
      plannedMinutes: durationMinutes * visit.requiredWorkers,
    })
  }

  for (const job of jobs) {
    const parsed = recurrenceSchema.safeParse(job.recurrence ?? { frequency: 'once' })
    if (!parsed.success) continue
    const contractualEnd = job.endDate && job.endDate < input.endsAt ? job.endDate : input.endsAt
    const lowerBound = job.startDate > input.startsAt ? job.startDate : input.startsAt
    if (contractualEnd <= lowerBound) continue
    const spanDays = Math.max(1, Math.ceil((contractualEnd.getTime() - lowerBound.getTime()) / 86_400_000))
    const occurrences = generateOccurrences({
      startAt: job.startDate,
      until: contractualEnd,
      recurrence: parsed.data,
      timezone: job.timezone,
      from: lowerBound,
      limit: spanDays + 8,
    }).filter((occurrence) => occurrence >= input.startsAt && occurrence < contractualEnd && occurrence < input.endsAt)

    for (const occurrence of occurrences) {
      const key = generationKey(occurrence)
      const obligationKey = `${job.id}:${key}`
      if (materializedKeys.has(obligationKey) || obligations.has(obligationKey)) continue
      obligations.set(obligationKey, {
        plannedMinutes: job.defaultDurationMin * job.requiredWorkers,
      })
    }
  }

  const cleanerIds = new Set(affectedVisits.flatMap((visit) => visit.assignments.map((assignment) => assignment.user.id)))
  const plannedMinutes = [...obligations.values()].reduce((sum, obligation) => sum + obligation.plannedMinutes, 0)
  const consequence = {
    canApply: blockers.length === 0,
    affectedVisits: obligations.size,
    materializedVisits: affectedVisits.length,
    expectedOccurrences: Math.max(0, obligations.size - affectedVisits.length),
    assignedCleaners: cleanerIds.size,
    plannedLabourHours: Math.round(plannedMinutes / 60 * 10) / 10,
    blockers: blockers.map((visit) => ({
      id: visit.id,
      scheduledStart: visit.scheduledStart,
      site: `${visit.site.client.displayName} · ${visit.site.name}`,
    })),
  }

  return { affectedVisits, consequence }
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  if (auth.user.membershipRole === 'employee') return NextResponse.json({ ok: false, error: 'Service pauses are a management view.' }, { status: 403 })
  const pauses = await prisma.servicePause.findMany({
    where: { organizationId: auth.user.organizationId },
    orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      client: { select: { id: true, displayName: true } },
      site: { select: { id: true, name: true, client: { select: { displayName: true } } } },
      job: { select: { id: true, name: true, site: { select: { name: true, client: { select: { displayName: true } } } } } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  })
  return NextResponse.json({ ok: true, data: pauses })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth.response
  const parsed = servicePauseCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid pause request.', details: parsed.error.flatten() }, { status: 400 })
  const target = await resolveTarget(auth.user.organizationId, parsed.data.scope, parsed.data.targetId)
  if (!target) return NextResponse.json({ ok: false, error: 'Pause target not found.' }, { status: 404 })

  const startsAt = zonedDateTimeToUtc(parsed.data.fromDate, '00:00', target.timezone)
  const endsAt = zonedDateTimeToUtc(addOperationalDays(parsed.data.untilDate, 1), '00:00', target.timezone)
  if (endsAt <= startsAt) return NextResponse.json({ ok: false, error: 'Pause end must be on or after its start date.' }, { status: 400 })
  const targetWhere = pauseTargetWhere(parsed.data.scope, target)

  if (request.nextUrl.searchParams.get('preview') === 'true') {
    const preview = await prisma.$transaction(async (tx) => {
      const overlappingPause = await findOverlappingPause(tx, {
        organizationId: auth.user.organizationId,
        pauseTargetWhere: targetWhere,
        startsAt,
        endsAt,
      })
      if (overlappingPause) {
        return { overlappingPause, impact: null }
      }
      const impact = await loadPauseImpact(tx, {
        organizationId: auth.user.organizationId,
        scope: parsed.data.scope,
        targetId: parsed.data.targetId,
        startsAt,
        endsAt,
      })
      return { overlappingPause: null, impact }
    })
    if (preview.overlappingPause) {
      return NextResponse.json({
        ok: false,
        error: 'This service already has an overlapping pause. End or adjust the existing pause instead of stacking another one.',
        code: 'SERVICE_PAUSE_OVERLAP',
        data: preview.overlappingPause,
      }, { status: 409 })
    }
    return NextResponse.json({
      ok: true,
      data: {
        target: target.label,
        timezone: target.timezone,
        startsAt,
        endsAt,
        consequence: preview.impact!.consequence,
      },
    })
  }

  const now = new Date()
  let applied
  try {
    applied = await prisma.$transaction(async (tx) => {
      const overlappingPause = await findOverlappingPause(tx, {
        organizationId: auth.user.organizationId,
        pauseTargetWhere: targetWhere,
        startsAt,
        endsAt,
      })
      if (overlappingPause) {
        throw new PauseApplyConflict(
          'SERVICE_PAUSE_OVERLAP',
          'This service already has an overlapping pause. End or adjust the existing pause instead of stacking another one.',
          overlappingPause,
        )
      }

      const impact = await loadPauseImpact(tx, {
        organizationId: auth.user.organizationId,
        scope: parsed.data.scope,
        targetId: parsed.data.targetId,
        startsAt,
        endsAt,
      })
      if (impact.consequence.blockers.length) {
        throw new PauseApplyConflict(
          'SERVICE_PAUSE_IN_PROGRESS',
          'Cannot fully apply this pause because affected work is already in progress.',
          impact.consequence,
        )
      }

      const created = await tx.servicePause.create({
        data: {
          organizationId: auth.user.organizationId,
          scope: parsed.data.scope,
          clientId: target.clientId,
          siteId: target.siteId,
          jobId: target.jobId,
          timezone: target.timezone,
          startsAt,
          endsAt,
          reason: parsed.data.reason,
          note: parsed.data.note,
          createdById: auth.user.id,
        },
      })

      if (impact.affectedVisits.length) {
        const updated = await tx.visit.updateMany({
          where: {
            id: { in: impact.affectedVisits.map((visit) => visit.id) },
            status: { in: [...CANCELLABLE] },
          },
          data: {
            status: 'cancelled',
            cancelledAt: now,
            cancellationReason: `Service pause: ${parsed.data.reason}`,
            servicePauseId: created.id,
            version: { increment: 1 },
          },
        })
        if (updated.count !== impact.affectedVisits.length) {
          throw new PauseApplyConflict(
            'SERVICE_PAUSE_CHANGED',
            'Affected work changed while the pause was being applied. Refresh the preview and try again.',
            impact.consequence,
          )
        }
      }

      return {
        pause: created,
        affectedVisits: impact.affectedVisits,
        consequence: impact.consequence,
      }
    })
  } catch (error) {
    if (error instanceof PauseApplyConflict) {
      return NextResponse.json({ ok: false, error: error.message, code: error.code, data: error.data }, { status: 409 })
    }
    throw error
  }

  for (const visit of applied.affectedVisits) {
    const recipients = [...new Set(visit.assignments.map((assignment) => assignment.user.id))]
    if (!recipients.length) continue
    const title = 'Cleaning visit paused'
    const body = `${visit.site.client.displayName} · ${visit.site.name} on ${visit.scheduledStart.toLocaleString('en-IE', { timeZone: visit.timezone })} will not run during the service pause. Reason: ${parsed.data.reason}.`
    const notice = await prisma.operationalNotice.create({
      data: {
        organizationId: auth.user.organizationId,
        siteId: visit.siteId,
        visitId: visit.id,
        type: 'schedule_change',
        priority: 'high',
        title,
        body,
        requiresAcknowledgement: false,
        createdById: auth.user.id,
        recipients: { create: recipients.map((userId) => ({ organizationId: auth.user.organizationId, userId })) },
      },
    })
    await enqueueNotification({
      organizationId: auth.user.organizationId,
      kind: 'operational_notice_push',
      createdBy: auth.user.email,
      entityType: 'operational_notice',
      entityId: notice.id,
      payload: { userIds: recipients, title, body, noticeId: notice.id, priority: 'high' },
    })
  }

  await logAudit(auth.user.email, 'create_service_pause', 'service_pause', applied.pause.id, {
    scope: parsed.data.scope,
    targetId: parsed.data.targetId,
    startsAt,
    endsAt,
    reason: parsed.data.reason,
    affectedVisits: applied.affectedVisits.map((visit) => visit.id),
    affectedObligations: applied.consequence.affectedVisits,
    expectedOccurrences: applied.consequence.expectedOccurrences,
    plannedLabourHours: applied.consequence.plannedLabourHours,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { pause: applied.pause, consequence: applied.consequence } }, { status: 201 })
}
