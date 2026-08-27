import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { enqueueNotification } from '../../../lib/notification-queue'
import { addOperationalDays, zonedDateTimeToUtc } from '../../../lib/operational-time'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../modules/scheduling/assignment-lifecycle'
import { servicePauseCreateSchema } from '../../../modules/scheduling/schemas'

const CANCELLABLE = ['scheduled', 'dispatched', 'acknowledged'] as const

function scopeVisitWhere(scope: 'client' | 'site' | 'job', targetId: string) {
  if (scope === 'client') return { site: { clientId: targetId } }
  if (scope === 'site') return { siteId: targetId }
  return { jobId: targetId }
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
  const pauseTargetWhere = parsed.data.scope === 'client'
    ? { scope: 'client' as const, clientId: target.clientId }
    : parsed.data.scope === 'site'
      ? { scope: 'site' as const, siteId: target.siteId }
      : { scope: 'job' as const, jobId: target.jobId }
  const overlappingPauses = await prisma.servicePause.findMany({
    where: { organizationId: auth.user.organizationId, ...pauseTargetWhere, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
    select: { id: true, startsAt: true, endsAt: true, endedEarlyAt: true },
  })
  const overlappingPause = overlappingPauses.find((pause) => !pause.endedEarlyAt || pause.endedEarlyAt > startsAt)
  if (overlappingPause) return NextResponse.json({
    ok: false,
    error: 'This service already has an overlapping pause. End or adjust the existing pause instead of stacking another one.',
    code: 'SERVICE_PAUSE_OVERLAP',
    data: overlappingPause,
  }, { status: 409 })
  const scopeWhere = scopeVisitWhere(parsed.data.scope, parsed.data.targetId)
  const [affectedVisits, blockers] = await Promise.all([
    prisma.visit.findMany({
      where: {
        organizationId: auth.user.organizationId,
        ...scopeWhere,
        status: { in: [...CANCELLABLE] },
        scheduledStart: { lt: endsAt },
        scheduledEnd: { gt: startsAt },
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
    prisma.visit.findMany({
      where: {
        organizationId: auth.user.organizationId,
        ...scopeWhere,
        status: 'in_progress',
        scheduledStart: { lt: endsAt },
        scheduledEnd: { gt: startsAt },
      },
      select: { id: true, scheduledStart: true, site: { select: { name: true, client: { select: { displayName: true } } } } },
    }),
  ])

  const cleanerIds = new Set(affectedVisits.flatMap((visit) => visit.assignments.map((assignment) => assignment.user.id)))
  const plannedMinutes = affectedVisits.reduce((sum, visit) => sum + Math.max(0, (visit.scheduledEnd.getTime() - visit.scheduledStart.getTime()) / 60_000) * visit.assignments.length, 0)
  const consequence = {
    canApply: blockers.length === 0,
    affectedVisits: affectedVisits.length,
    assignedCleaners: cleanerIds.size,
    plannedLabourHours: Math.round(plannedMinutes / 60 * 10) / 10,
    blockers: blockers.map((visit) => ({ id: visit.id, scheduledStart: visit.scheduledStart, site: `${visit.site.client.displayName} · ${visit.site.name}` })),
  }
  if (request.nextUrl.searchParams.get('preview') === 'true') {
    return NextResponse.json({ ok: true, data: { target: target.label, timezone: target.timezone, startsAt, endsAt, consequence } })
  }
  if (blockers.length) {
    return NextResponse.json({ ok: false, error: 'Cannot fully apply this pause because affected work is already in progress.', code: 'SERVICE_PAUSE_IN_PROGRESS', data: consequence }, { status: 409 })
  }

  const now = new Date()
  const pause = await prisma.$transaction(async (tx) => {
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
    if (affectedVisits.length) {
      await tx.visit.updateMany({
        where: { id: { in: affectedVisits.map((visit) => visit.id) }, status: { in: [...CANCELLABLE] } },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          cancellationReason: `Service pause: ${parsed.data.reason}`,
          servicePauseId: created.id,
          version: { increment: 1 },
        },
      })
    }
    return created
  })

  for (const visit of affectedVisits) {
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

  await logAudit(auth.user.email, 'create_service_pause', 'service_pause', pause.id, {
    scope: parsed.data.scope,
    targetId: parsed.data.targetId,
    startsAt,
    endsAt,
    reason: parsed.data.reason,
    affectedVisits: affectedVisits.map((visit) => visit.id),
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { pause, consequence } }, { status: 201 })
}
