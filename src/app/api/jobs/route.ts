import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { enqueueNotification } from '../../../lib/notification-queue'
import { jobCreateSchema } from '../../../modules/scheduling/schemas'
import { generateOccurrences, generationKey } from '../../../modules/scheduling/recurrence'
import { buildDefaultTeamAllocator } from '../../../modules/scheduling/default-team'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../modules/scheduling/assignment-lifecycle'
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
  const initialHorizon = new Date(parsed.data.startAt.getTime() + 90 * 86_400_000)
  const requestedUntil = parsed.data.generateUntil ?? initialHorizon
  const until = parsed.data.endDate && parsed.data.endDate < requestedUntil ? parsed.data.endDate : requestedUntil
  if (until < parsed.data.startAt) return NextResponse.json({ ok: false, error: 'Generation end must be after the start.' }, { status: 400 })
  const occurrences = generateOccurrences({
    startAt: parsed.data.startAt,
    until,
    recurrence: parsed.data.recurrence,
    timezone: parsed.data.timezone,
  })
  if (!occurrences.length) return NextResponse.json({ ok: false, error: 'Recurrence did not generate any visits.' }, { status: 400 })


  const requiredWorkers = parsed.data.requiredWorkers ?? planVersion.requiredWorkers
  const result = await prisma.$transaction(async (tx) => {
    const allocationEnd = new Date(Math.max(...occurrences.map((start) => start.getTime() + duration * 60_000)))
    const allocator = await buildDefaultTeamAllocator(tx, {
      organizationId: auth.user.organizationId,
      userIds: assigneeIds,
      from: occurrences[0],
      to: allocationEnd,
      timezone: parsed.data.timezone,
    })
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
      generatedThrough: until,
      defaultDurationMin: duration,
      timezone: parsed.data.timezone,
      requiredWorkers,
      instructions: parsed.data.instructions,
      defaultAssignees: assigneeIds.length ? {
        create: assigneeIds.map((userId, priority) => ({ organizationId: auth.user.organizationId, userId, priority })),
      } : undefined,
    } })
    const visitIds: string[] = []
    const assignedUserIds = new Set<string>()
    for (let index = 0; index < occurrences.length; index += 1) {
      const start = occurrences[index]
      const end = new Date(start.getTime() + duration * 60_000)
      const visitAssigneeIds = allocator.select(start, end, requiredWorkers)
      for (const userId of visitAssigneeIds) assignedUserIds.add(userId)
      const visit = await tx.visit.create({ data: {
        organizationId: auth.user.organizationId,
        jobId: created.id,
        siteId: plan.siteId,
        servicePlanVersionId: planVersion.id,
        scheduledStart: start,
        scheduledEnd: end,
        timezone: parsed.data.timezone,
        sequenceNumber: index + 1,
        generationKey: generationKey(start),
        requiredWorkers,
        status: visitAssigneeIds.length ? 'dispatched' : 'scheduled',
        assignments: {
          create: visitAssigneeIds.map((userId) => ({
            organizationId: auth.user.organizationId,
            userId,
            status: 'assigned',
          })),
        },
      }, select: { id: true } })
      visitIds.push(visit.id)
    }
    return { job: created, visitIds, assignedUserIds: [...assignedUserIds] }
  })

  if (result.assignedUserIds.length) {
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
          : `${occurrences.length} recurring visits for ${plan.site.client.displayName} · ${plan.site.name} were created. Open your schedule for the occurrences assigned to you. First visit: ${first.toLocaleString('en-IE', { timeZone: parsed.data.timezone })}.`,
        requiresAcknowledgement: true,
        createdById: auth.user.id,
        recipients: { create: result.assignedUserIds.map((userId) => ({ organizationId: auth.user.organizationId, userId })) },
      },
    })
    await enqueueNotification({
      organizationId: auth.user.organizationId,
      kind: 'operational_notice_push',
      createdBy: auth.user.email,
      entityType: 'operational_notice',
      entityId: notice.id,
      payload: { userIds: result.assignedUserIds, title: notice.title, body: notice.body, noticeId: notice.id, priority: notice.priority },
    })
  }

  await logAudit(auth.user.email, 'create_job', 'job', result.job.id, {
    visitCount: occurrences.length,
    siteId: plan.siteId,
    defaultAssigneeIds: assigneeIds,
    assignedUserIds: result.assignedUserIds,
    timezone: parsed.data.timezone,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { ...result.job, generatedVisits: occurrences.length } }, { status: 201 })
}
