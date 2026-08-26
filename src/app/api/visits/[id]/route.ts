import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { enqueueNotification } from '../../../../lib/notification-queue'
import { visitUpdateSchema } from '../../../../modules/scheduling/schemas'
import { ACTIVE_ASSIGNMENT_STATUSES, isActiveAssignmentStatus } from '../../../../modules/scheduling/assignment-lifecycle'
import { workforceConstraintForWindow } from '../../../../modules/scheduling/workforce-constraints'

const EXECUTABLE_ROLES = ['employee', 'field_supervisor'] as const

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const { id } = await params
  const visit = await prisma.visit.findFirst({
    where: {
      id,
      organizationId: auth.user.organizationId,
      ...(auth.user.membershipRole === 'employee' ? {
        assignments: { some: { userId: auth.user.id, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } } },
      } : {}),
    },
    include: {
      site: { include: { client: true, access: true, areas: true } },
      job: true,
      servicePlanVersion: { include: { tasks: { orderBy: { sortOrder: 'asc' } } } },
      assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
      taskResults: { include: { versionTask: true, evidence: true }, orderBy: { versionTask: { sortOrder: 'asc' } } },
      timeEntries: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { startedAt: 'desc' } },
      evidenceAssets: { orderBy: { createdAt: 'desc' } },
      incidents: { orderBy: { createdAt: 'desc' } },
      reviews: { include: { reviewer: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' } },
    },
  })
  if (!visit) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, data: visit })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth.response
  const { id } = await params
  const parsed = visitUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })

  const current = await prisma.visit.findFirst({
    where: { id, organizationId: auth.user.organizationId },
    include: { assignments: true, site: { include: { client: { select: { displayName: true } } } } },
  })
  if (!current) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (current.version !== parsed.data.version) return NextResponse.json({ ok: false, error: 'Visit changed. Refresh and try again.' }, { status: 409 })
  if (current.status === 'completed') return NextResponse.json({ ok: false, error: 'Completed visits are immutable. Use the evidence review flow to request rework.', code: 'COMPLETED_VISIT_IMMUTABLE' }, { status: 409 })

  const cancelling = parsed.data.status === 'cancelled'
  if (cancelling && !parsed.data.cancellationReason?.trim()) {
    return NextResponse.json({ ok: false, error: 'A cancellation reason is required.', code: 'CANCELLATION_REASON_REQUIRED' }, { status: 400 })
  }

  const start = parsed.data.scheduledStart ?? current.scheduledStart
  const end = parsed.data.scheduledEnd ?? current.scheduledEnd
  if (end <= start) return NextResponse.json({ ok: false, error: 'Visit end must be after start.' }, { status: 400 })

  const currentActiveIds = current.assignments.filter((item) => isActiveAssignmentStatus(item.status)).map((item) => item.userId)
  const assigneeIds = parsed.data.assigneeIds ? [...new Set(parsed.data.assigneeIds)] : currentActiveIds

  if (!cancelling && assigneeIds.length) {
    const members = await prisma.membership.findMany({
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
    })
    if (members.length !== assigneeIds.length) return NextResponse.json({
      ok: false,
      error: 'Every assignee must be an active cleaner or field supervisor who can execute visits.',
      code: 'ASSIGNEE_NOT_EXECUTABLE',
    }, { status: 400 })

    const [conflicts, availability] = await Promise.all([
      prisma.visitAssignment.findMany({
        where: {
          organizationId: auth.user.organizationId,
          userId: { in: assigneeIds },
          status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
          visit: {
            id: { not: id },
            status: { notIn: ['cancelled', 'completed', 'missed'] },
            scheduledStart: { lt: end },
            scheduledEnd: { gt: start },
          },
        },
        include: {
          user: { select: { name: true, email: true } },
          visit: { select: { id: true, scheduledStart: true, scheduledEnd: true } },
        },
      }),
      prisma.availability.findMany({
        where: {
          organizationId: auth.user.organizationId,
          userId: { in: assigneeIds },
          cancelledAt: null,
          startsAt: { lt: end },
          endsAt: { gt: start },
        },
        include: { user: { select: { name: true, email: true } } },
      }),
    ])
    if (conflicts.length) return NextResponse.json({ ok: false, error: 'Scheduling conflict', code: 'ASSIGNEE_OVERLAP', data: conflicts }, { status: 409 })
    if (availability.length) return NextResponse.json({
      ok: false,
      error: 'An assignee is unavailable at this time.',
      code: 'ASSIGNEE_UNAVAILABLE',
      data: availability.map((entry) => ({ user: entry.user.name ?? entry.user.email, startsAt: entry.startsAt, endsAt: entry.endsAt, reason: entry.reason })),
    }, { status: 409 })

    const workforceConflicts = members.flatMap((membership) => {
      const profile = membership.user.workforceProfile
      const conflict = workforceConstraintForWindow(profile ? {
        studySchedules: profile.studySchedules,
        leaves: profile.leaves.map((leave) => ({
          kind: leave.kind as 'school_holiday' | 'personal_leave',
          startsAt: leave.startsAt,
          endsAt: leave.endsAt,
          reason: leave.reason,
        })),
      } : null, start, end, current.timezone)
      return conflict ? [{ userId: membership.user.id, user: membership.user.name ?? membership.user.email, ...conflict }] : []
    })
    if (workforceConflicts.length) return NextResponse.json({
      ok: false,
      error: workforceConflicts.some((item) => item.kind === 'personal_leave')
        ? 'An assignee is on personal leave at this time.'
        : 'An assignee is in school at this time.',
      code: 'ASSIGNEE_WORKFORCE_CONSTRAINT',
      data: workforceConflicts,
    }, { status: 409 })
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (parsed.data.assigneeIds) {
      const selected = new Set(assigneeIds)
      for (const assignment of current.assignments) {
        if (selected.has(assignment.userId)) {
          if (!isActiveAssignmentStatus(assignment.status)) {
            await tx.visitAssignment.update({
              where: { id: assignment.id },
              data: { status: 'assigned', assignedAt: new Date(), declinedAt: null, declineReason: null },
            })
          }
        } else if (isActiveAssignmentStatus(assignment.status)) {
          await tx.visitAssignment.update({ where: { id: assignment.id }, data: { status: 'removed' } })
        }
      }
      const existingIds = new Set(current.assignments.map((assignment) => assignment.userId))
      const newIds = assigneeIds.filter((userId) => !existingIds.has(userId))
      if (newIds.length) await tx.visitAssignment.createMany({
        data: newIds.map((userId) => ({ organizationId: auth.user.organizationId, visitId: id, userId, status: 'assigned' })),
      })
    }

    return tx.visit.update({
      where: { id },
      data: {
        scheduledStart: parsed.data.scheduledStart,
        scheduledEnd: parsed.data.scheduledEnd,
        dispatchNotes: parsed.data.dispatchNotes,
        status: parsed.data.status,
        cancellationReason: cancelling ? parsed.data.cancellationReason!.trim() : parsed.data.cancellationReason,
        cancelledAt: parsed.data.status === 'cancelled' ? new Date() : parsed.data.status ? null : undefined,
        version: { increment: 1 },
      },
      include: { assignments: { include: { user: { select: { id: true, name: true, email: true } } } } },
    })
  })

  const updatedActiveIds = updated.assignments.filter((item) => isActiveAssignmentStatus(item.status)).map((item) => item.userId)
  const notificationRecipients = [...new Set([...currentActiveIds, ...updatedActiveIds])]
  if (notificationRecipients.length) {
    const title = cancelling ? 'Cleaning visit cancelled' : 'Visit schedule updated'
    const body = cancelling
      ? `${current.site.client.displayName} · ${current.site.name} on ${updated.scheduledStart.toLocaleString('en-IE', { timeZone: updated.timezone })} was cancelled. Reason: ${updated.cancellationReason}.`
      : `Your visit at ${current.site.client.displayName} · ${current.site.name} on ${updated.scheduledStart.toLocaleString('en-IE', { timeZone: updated.timezone })} was updated. ${updated.dispatchNotes ?? 'Open the visit for the latest operational details.'}`
    const notice = await prisma.operationalNotice.create({
      data: {
        organizationId: auth.user.organizationId,
        siteId: current.siteId,
        visitId: id,
        type: 'schedule_change',
        priority: 'high',
        title,
        body,
        requiresAcknowledgement: true,
        createdById: auth.user.id,
        recipients: { create: notificationRecipients.map((userId) => ({ organizationId: auth.user.organizationId, userId })) },
      },
    })
    await enqueueNotification({
      organizationId: auth.user.organizationId,
      kind: 'operational_notice_push',
      createdBy: auth.user.email,
      entityType: 'operational_notice',
      entityId: notice.id,
      payload: { userIds: notificationRecipients, title: notice.title, body: notice.body, noticeId: notice.id, priority: notice.priority },
    })
  }

  await logAudit(auth.user.email, cancelling ? 'cancel_visit' : 'update_visit', 'visit', id, {
    previousStatus: current.status,
    status: updated.status,
    scheduledStart: updated.scheduledStart,
    cancellationReason: updated.cancellationReason,
    previousAssigneeIds: currentActiveIds,
    assigneeIds: updatedActiveIds,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: updated })
}
