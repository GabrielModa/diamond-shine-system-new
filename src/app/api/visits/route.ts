import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { enqueueNotification } from '../../../lib/notification-queue'
import { asInputJson } from '../../../modules/operations/json'
import { ACTIVE_ASSIGNMENT_STATUSES, NON_OPERATIONAL_VISIT_STATUSES } from '../../../modules/scheduling/assignment-lifecycle'
import { workforceConstraintForWindow } from '../../../modules/scheduling/workforce-constraints'

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  siteId: z.string().optional(),
  assigneeId: z.string().optional(),
  mode: z.enum(['operational', 'history', 'all']).default('operational'),
})

const manualVisitSchema = z.object({
  servicePlanId: z.string().min(1),
  scheduledStart: z.coerce.date(),
  durationMinutes: z.number().int().min(1).max(24 * 60).optional(),
  requiredWorkers: z.number().int().min(1).max(100).optional(),
  assigneeIds: z.array(z.string().min(1)).max(100).default([]),
  reason: z.enum(['extra_cleaning', 'client_request', 'cover_visit', 'deep_clean', 'other']).default('extra_cleaning'),
  dispatchNotes: z.string().trim().max(4000).optional().nullable(),
})

const EXECUTABLE_ROLES = ['employee', 'field_supervisor'] as const
const REASON_LABELS: Record<z.infer<typeof manualVisitSchema>['reason'], string> = {
  extra_cleaning: 'Extra cleaning',
  client_request: 'Client request',
  cover_visit: 'Cover visit',
  deep_clean: 'Deep clean',
  other: 'Extra visit',
}

function humanList(values: string[]) {
  const unique = [...new Set(values.filter(Boolean))]
  if (unique.length <= 1) return unique[0] ?? 'Selected cleaner'
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`
  return `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  const from = parsed.data.from ?? new Date(Date.now() - 7 * 86_400_000)
  const to = parsed.data.to ?? new Date(Date.now() + 35 * 86_400_000)
  if (to <= from) return NextResponse.json({ ok: false, error: 'To must be after from.' }, { status: 400 })
  const ownOnly = auth.user.membershipRole === 'employee'
  const statusFilter = parsed.data.mode === 'operational'
    ? { notIn: [...NON_OPERATIONAL_VISIT_STATUSES] }
    : parsed.data.mode === 'history'
      ? { in: [...NON_OPERATIONAL_VISIT_STATUSES] }
      : undefined

  const visits = await prisma.visit.findMany({
    where: {
      organizationId: auth.user.organizationId,
      scheduledStart: { gte: from, lte: to },
      status: statusFilter,
      ...(parsed.data.siteId ? { siteId: parsed.data.siteId } : {}),
      ...(ownOnly ? {
        assignments: { some: { userId: auth.user.id, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } } },
      } : parsed.data.assigneeId ? {
        assignments: { some: { userId: parsed.data.assigneeId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } } },
      } : {}),
    },
    orderBy: { scheduledStart: 'asc' },
    include: {
      site: { include: { client: { select: { id: true, displayName: true } } } },
      job: { select: { id: true, name: true } },
      servicePlanVersion: { select: { id: true, versionNumber: true } },
      assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  })
  return NextResponse.json({ ok: true, data: visits })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth.response
  const parsed = manualVisitSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid visit', details: parsed.error.flatten() }, { status: 400 })

  const organizationId = auth.user.organizationId
  const plan = await prisma.servicePlan.findFirst({
    where: { id: parsed.data.servicePlanId, organizationId, archivedAt: null, status: 'published' },
    include: {
      site: { include: { client: { select: { id: true, displayName: true } } } },
      versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
    },
  })
  if (!plan) return NextResponse.json({ ok: false, error: 'Choose an active configured service before adding a visit.' }, { status: 400 })
  const version = plan.versions[0]
  if (!version) return NextResponse.json({ ok: false, error: 'This service must be activated before visits can be scheduled.' }, { status: 409 })

  const start = parsed.data.scheduledStart
  const durationMinutes = parsed.data.durationMinutes ?? version.expectedDurationMinutes
  const requiredWorkers = parsed.data.requiredWorkers ?? version.requiredWorkers
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  const assigneeIds = [...new Set(parsed.data.assigneeIds)]

  const members = assigneeIds.length ? await prisma.membership.findMany({
    where: {
      organizationId,
      userId: { in: assigneeIds },
      status: 'active',
      role: { in: [...EXECUTABLE_ROLES] },
      user: { status: 'active' },
    },
    include: {
      user: {
        select: {
          id: true, name: true, email: true,
          workforceProfile: { include: { studySchedules: true, recurringUnavailability: true, leaves: true } },
        },
      },
    },
  }) : []
  if (members.length !== assigneeIds.length) return NextResponse.json({
    ok: false,
    error: 'Every assignee must be an active cleaner or field supervisor who can execute visits.',
    code: 'ASSIGNEE_NOT_EXECUTABLE',
  }, { status: 400 })

  const setupRequired = members.filter((membership) => !membership.user.workforceProfile?.weeklyTargetConfigured)
  if (setupRequired.length) return NextResponse.json({
    ok: false,
    error: `${humanList(setupRequired.map((membership) => membership.user.name ?? membership.user.email))} still needs workforce setup before being assigned to visits.`,
    code: 'ASSIGNEE_WORKFORCE_SETUP_REQUIRED',
  }, { status: 409 })

  if (assigneeIds.length) {
    const [conflicts, availability, organization] = await Promise.all([
      prisma.visitAssignment.findMany({
        where: {
          organizationId,
          userId: { in: assigneeIds },
          status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
          visit: {
            status: { notIn: ['cancelled', 'completed', 'missed'] },
            scheduledStart: { lt: end },
            scheduledEnd: { gt: start },
          },
        },
        include: {
          user: { select: { name: true, email: true } },
          visit: { select: { site: { select: { name: true, client: { select: { displayName: true } } } } } },
        },
      }),
      prisma.availability.findMany({
        where: { organizationId, userId: { in: assigneeIds }, cancelledAt: null, startsAt: { lt: end }, endsAt: { gt: start } },
        include: { user: { select: { name: true, email: true } } },
      }),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    ])
    if (conflicts.length) {
      const first = conflicts[0]
      return NextResponse.json({
        ok: false,
        error: `${humanList(conflicts.map((entry) => entry.user.name ?? entry.user.email))} already has overlapping work${first ? ` at ${first.visit.site.client.displayName} · ${first.visit.site.name}` : ''}. Choose another cleaner or change the time.`,
        code: 'ASSIGNEE_OVERLAP',
      }, { status: 409 })
    }
    if (availability.length) {
      const reason = availability.find((entry) => entry.reason)?.reason
      return NextResponse.json({
        ok: false,
        error: `${humanList(availability.map((entry) => entry.user.name ?? entry.user.email))} is unavailable during this visit${reason ? ` · ${reason}` : ''}. Choose another cleaner or change the time.`,
        code: 'ASSIGNEE_UNAVAILABLE',
      }, { status: 409 })
    }

    const workforceTimezone = organization?.timezone ?? plan.site.timezone ?? 'Europe/Dublin'
    const workforceConflicts = members.flatMap((membership) => {
      const profile = membership.user.workforceProfile
      const conflict = workforceConstraintForWindow(profile ? {
        studySchedules: profile.studySchedules,
        recurringUnavailability: profile.recurringUnavailability,
        leaves: profile.leaves.map((leave) => ({
          kind: leave.kind as 'school_holiday' | 'personal_leave',
          startsAt: leave.startsAt,
          endsAt: leave.endsAt,
          reason: leave.reason,
        })),
      } : null, start, end, workforceTimezone)
      return conflict ? [{ user: membership.user.name ?? membership.user.email, ...conflict }] : []
    })
    if (workforceConflicts.length) {
      const leave = workforceConflicts.filter((item) => item.kind === 'personal_leave')
      const recurring = workforceConflicts.filter((item) => item.kind === 'recurring_unavailability')
      const school = workforceConflicts.filter((item) => item.kind === 'school')
      const error = leave.length
        ? `${humanList(leave.map((item) => item.user))} is on leave during this visit. Choose another cleaner or change the time.`
        : recurring.length
          ? `${humanList(recurring.map((item) => item.user))} has recurring unavailability during this visit. Choose another cleaner or change the time.`
          : `${humanList(school.map((item) => item.user))} is in school during this visit. Choose another cleaner or change the time.`
      return NextResponse.json({ ok: false, error, code: 'ASSIGNEE_WORKFORCE_CONSTRAINT' }, { status: 409 })
    }
  }

  const reasonLabel = REASON_LABELS[parsed.data.reason]
  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        organizationId,
        contractId: plan.contractId,
        siteId: plan.siteId,
        servicePlanId: plan.id,
        servicePlanVersionId: version.id,
        name: `${plan.name} · ${reasonLabel}`,
        status: 'active',
        recurrence: asInputJson({ frequency: 'once', source: 'manual_extra', reason: parsed.data.reason }),
        startDate: start,
        endDate: end,
        generatedThrough: start,
        defaultDurationMin: durationMinutes,
        timezone: plan.site.timezone,
        requiredWorkers,
        instructions: parsed.data.dispatchNotes ?? plan.description,
        defaultAssignees: assigneeIds.length ? {
          create: assigneeIds.map((userId, priority) => ({ organizationId, userId, priority })),
        } : undefined,
      },
    })
    const visit = await tx.visit.create({
      data: {
        organizationId,
        jobId: job.id,
        siteId: plan.siteId,
        servicePlanVersionId: version.id,
        scheduledStart: start,
        scheduledEnd: end,
        timezone: plan.site.timezone,
        sequenceNumber: 1,
        generationKey: `manual:${randomUUID()}`,
        requiredWorkers,
        dispatchNotes: parsed.data.dispatchNotes,
        status: assigneeIds.length ? 'dispatched' : 'scheduled',
        assignments: assigneeIds.length ? {
          create: assigneeIds.map((userId) => ({ organizationId, userId, status: 'assigned' })),
        } : undefined,
      },
      include: { assignments: true },
    })
    return { job, visit }
  })

  if (assigneeIds.length) {
    const notice = await prisma.operationalNotice.create({
      data: {
        organizationId,
        siteId: plan.siteId,
        visitId: result.visit.id,
        type: 'schedule_change',
        priority: 'high',
        title: 'Extra cleaning visit assigned',
        body: `${plan.site.client.displayName} · ${plan.site.name} on ${start.toLocaleString('en-IE', { timeZone: plan.site.timezone })}. ${reasonLabel}. Open the visit for details.`,
        requiresAcknowledgement: true,
        createdById: auth.user.id,
        recipients: { create: assigneeIds.map((userId) => ({ organizationId, userId })) },
      },
    })
    await enqueueNotification({
      organizationId,
      kind: 'operational_notice_push',
      createdBy: auth.user.email,
      entityType: 'operational_notice',
      entityId: notice.id,
      payload: { userIds: assigneeIds, title: notice.title, body: notice.body, noticeId: notice.id, priority: notice.priority },
    })
  }

  await logAudit(auth.user.email, 'create_manual_visit', 'visit', result.visit.id, {
    servicePlanId: plan.id,
    siteId: plan.siteId,
    scheduledStart: start,
    durationMinutes,
    requiredWorkers,
    assigneeIds,
    reason: parsed.data.reason,
  }, organizationId)

  return NextResponse.json({ ok: true, data: result.visit }, { status: 201 })
}
