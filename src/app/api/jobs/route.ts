import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { enqueueNotification } from '../../../lib/notification-queue'
import { jobCreateSchema } from '../../../modules/scheduling/schemas'
import { generateOccurrences, generationKey } from '../../../modules/scheduling/recurrence'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../modules/scheduling/assignment-lifecycle'
import { workforceConstraintForWindow } from '../../../modules/scheduling/workforce-constraints'
import { asInputJson } from '../../../modules/operations/json'

const EXECUTABLE_ROLES = ['employee', 'field_supervisor'] as const

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const jobs = await prisma.job.findMany({
    where: { organizationId: auth.user.organizationId, archivedAt: null },
    orderBy: { startDate: 'desc' },
    include: {
      site: { include: { client: { select: { displayName: true } } } },
      servicePlanVersion: { select: { versionNumber: true } },
      visits: {
        where: { status: { notIn: ['cancelled', 'missed'] } },
        select: { requiredWorkers: true, assignments: { select: { status: true } } },
      },
      _count: { select: { visits: true } },
    },
  })
  return NextResponse.json({ ok: true, data: jobs.map((job) => ({
    ...job,
    operationalVisits: job.visits.length,
    coverageGaps: job.visits.filter((visit) => visit.assignments.filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)).length < visit.requiredWorkers).length,
    visits: undefined,
  })) })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth.response
  const parsed = jobCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })

  const plan = await prisma.servicePlan.findFirst({
    where: { id: parsed.data.servicePlanId, organizationId: auth.user.organizationId, archivedAt: null },
    include: {
      site: { include: { client: { select: { displayName: true } }, preferredAssignees: { orderBy: { priority: 'asc' } } } },
      versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
    },
  })
  if (!plan) return NextResponse.json({ ok: false, error: 'Service plan not found' }, { status: 400 })
  const planVersion = plan.versions[0]
  if (!planVersion) return NextResponse.json({ ok: false, error: 'Publish the service plan before scheduling work.' }, { status: 409 })

  const assigneeIds = [...new Set(parsed.data.assigneeIds)]
  const eligible = assigneeIds.length ? await prisma.membership.findMany({
    where: {
      organizationId: auth.user.organizationId,
      userId: { in: assigneeIds },
      status: 'active',
      role: { in: [...EXECUTABLE_ROLES] },
      user: { status: 'active' },
    },
    include: {
      user: {
        select: {
          id: true, name: true, email: true,
          workforceProfile: { include: { studySchedules: true, leaves: true } },
        },
      },
    },
  }) : []
  if (eligible.length !== assigneeIds.length) {
    return NextResponse.json({
      ok: false,
      error: 'Every assignee must be an active cleaner or field supervisor who can execute visits.',
      code: 'ASSIGNEE_NOT_EXECUTABLE',
    }, { status: 400 })
  }

  const duration = parsed.data.durationMinutes ?? planVersion.expectedDurationMinutes
  const until = parsed.data.generateUntil ?? parsed.data.endDate ?? new Date(parsed.data.startAt.getTime() + 90 * 86_400_000)
  if (until < parsed.data.startAt) return NextResponse.json({ ok: false, error: 'Generation end must be after the start.' }, { status: 400 })
  const occurrences = generateOccurrences({
    startAt: parsed.data.startAt,
    until,
    recurrence: parsed.data.recurrence,
    timezone: parsed.data.timezone,
  })
  if (!occurrences.length) return NextResponse.json({ ok: false, error: 'Recurrence did not generate any visits.' }, { status: 400 })

  if (assigneeIds.length) {
    const firstStart = occurrences[0]
    const finish = new Date(Math.max(...occurrences.map((start) => start.getTime() + duration * 60_000)))
    const [availability, assignedVisits] = await Promise.all([
      prisma.availability.findMany({
        where: {
          organizationId: auth.user.organizationId,
          userId: { in: assigneeIds },
          cancelledAt: null,
          startsAt: { lt: finish },
          endsAt: { gt: firstStart },
        },
        include: { user: { select: { name: true, email: true } } },
      }),
      prisma.visitAssignment.findMany({
        where: {
          organizationId: auth.user.organizationId,
          userId: { in: assigneeIds },
          status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
          visit: {
            status: { notIn: ['cancelled', 'completed', 'missed'] },
            scheduledStart: { lt: finish },
            scheduledEnd: { gt: firstStart },
          },
        },
        include: {
          user: { select: { name: true, email: true } },
          visit: {
            select: {
              scheduledStart: true, scheduledEnd: true,
              site: { select: { name: true, client: { select: { displayName: true } } } },
            },
          },
        },
      }),
    ])

    const manualConflicts = availability.filter((entry) => occurrences.some((start) => {
      const end = new Date(start.getTime() + duration * 60_000)
      return start < entry.endsAt && end > entry.startsAt
    }))
    if (manualConflicts.length) return NextResponse.json({
      ok: false,
      error: 'An assigned worker is unavailable for one or more generated visits.',
      code: 'ASSIGNEE_UNAVAILABLE',
      data: manualConflicts.map((entry) => ({
        user: entry.user.name ?? entry.user.email,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        reason: entry.reason,
      })),
    }, { status: 409 })

    const workforceConflicts = eligible.flatMap((membership) => occurrences.flatMap((start) => {
      const end = new Date(start.getTime() + duration * 60_000)
      const profile = membership.user.workforceProfile
      const conflict = workforceConstraintForWindow(profile ? {
        studySchedules: profile.studySchedules,
        leaves: profile.leaves.map((leave) => ({
          kind: leave.kind as 'school_holiday' | 'personal_leave',
          startsAt: leave.startsAt,
          endsAt: leave.endsAt,
          reason: leave.reason,
        })),
      } : null, start, end, parsed.data.timezone)
      return conflict ? [{
        userId: membership.user.id,
        user: membership.user.name ?? membership.user.email,
        ...conflict,
      }] : []
    }))
    if (workforceConflicts.length) return NextResponse.json({
      ok: false,
      error: workforceConflicts.some((item) => item.kind === 'personal_leave')
        ? 'An assigned worker is on personal leave during this work.'
        : 'An assigned worker is in school during this work.',
      code: 'ASSIGNEE_WORKFORCE_CONSTRAINT',
      data: workforceConflicts,
    }, { status: 409 })

    const assignmentConflicts = assignedVisits.filter((assignment) => occurrences.some((start) => {
      const end = new Date(start.getTime() + duration * 60_000)
      return start < assignment.visit.scheduledEnd && end > assignment.visit.scheduledStart
    }))
    if (assignmentConflicts.length) return NextResponse.json({
      ok: false,
      error: 'An assigned worker already has work during one or more generated visits.',
      code: 'ASSIGNEE_OVERLAP',
      data: assignmentConflicts.map((assignment) => ({
        user: assignment.user.name ?? assignment.user.email,
        startsAt: assignment.visit.scheduledStart,
        endsAt: assignment.visit.scheduledEnd,
        site: `${assignment.visit.site.client.displayName} · ${assignment.visit.site.name}`,
      })),
    }, { status: 409 })
  }

  const result = await prisma.$transaction(async (tx) => {
    const created = await tx.job.create({ data: {
      organizationId: auth.user.organizationId,
      contractId: plan.contractId,
      siteId: plan.siteId,
      servicePlanId: plan.id,
      servicePlanVersionId: planVersion.id,
      name: parsed.data.name,
      status: 'active',
      recurrence: asInputJson(parsed.data.recurrence),
      startDate: parsed.data.startAt,
      endDate: parsed.data.endDate,
      defaultDurationMin: duration,
      timezone: parsed.data.timezone,
      requiredWorkers: parsed.data.requiredWorkers ?? planVersion.requiredWorkers,
      instructions: parsed.data.instructions,
    } })
    const visitIds: string[] = []
    for (let index = 0; index < occurrences.length; index += 1) {
      const start = occurrences[index]
      const visit = await tx.visit.create({ data: {
        organizationId: auth.user.organizationId,
        jobId: created.id,
        siteId: plan.siteId,
        servicePlanVersionId: planVersion.id,
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() + duration * 60_000),
        timezone: parsed.data.timezone,
        sequenceNumber: index + 1,
        generationKey: generationKey(start),
        requiredWorkers: parsed.data.requiredWorkers ?? planVersion.requiredWorkers,
        status: assigneeIds.length ? 'dispatched' : 'scheduled',
        assignments: {
          create: assigneeIds.map((userId) => ({
            organizationId: auth.user.organizationId,
            userId,
            status: 'assigned',
          })),
        },
      }, select: { id: true } })
      visitIds.push(visit.id)
    }
    return { job: created, visitIds }
  })

  if (assigneeIds.length) {
    const firstVisitId = result.visitIds[0]
    const first = occurrences[0]
    const notice = await prisma.operationalNotice.create({
      data: {
        organizationId: auth.user.organizationId,
        siteId: plan.siteId,
        visitId: firstVisitId,
        type: 'schedule_change',
        priority: 'high',
        title: occurrences.length === 1 ? 'New cleaning visit assigned' : 'New recurring cleaning work assigned',
        body: occurrences.length === 1
          ? `${plan.site.client.displayName} · ${plan.site.name} on ${first.toLocaleString('en-IE', { timeZone: parsed.data.timezone })}. Open the schedule for details.`
          : `${occurrences.length} visits for ${plan.site.client.displayName} · ${plan.site.name} were added to your schedule. First visit: ${first.toLocaleString('en-IE', { timeZone: parsed.data.timezone })}.`,
        requiresAcknowledgement: true,
        createdById: auth.user.id,
        recipients: { create: assigneeIds.map((userId) => ({ organizationId: auth.user.organizationId, userId })) },
      },
    })
    await enqueueNotification({
      organizationId: auth.user.organizationId,
      kind: 'operational_notice_push',
      createdBy: auth.user.email,
      entityType: 'operational_notice',
      entityId: notice.id,
      payload: { userIds: assigneeIds, title: notice.title, body: notice.body, noticeId: notice.id, priority: notice.priority },
    })
  }

  await logAudit(auth.user.email, 'create_job', 'job', result.job.id, {
    visitCount: occurrences.length,
    siteId: plan.siteId,
    assigneeIds,
    timezone: parsed.data.timezone,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { ...result.job, generatedVisits: occurrences.length } }, { status: 201 })
}
