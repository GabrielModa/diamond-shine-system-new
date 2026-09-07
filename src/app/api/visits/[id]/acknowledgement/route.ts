import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { enqueueNotification } from '../../../../../lib/notification-queue'
import { acknowledgementSchema } from '../../../../../modules/scheduling/schemas'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../../../modules/scheduling/assignment-lifecycle'
import { isRecurringAssignmentRule, markRecurringCommitmentAccepted } from '../../../../../modules/scheduling/recurring-commitment'

const ACK_ELIGIBLE_VISIT_STATUSES = ['scheduled', 'dispatched', 'acknowledged'] as const

async function reconcileVisitAcknowledgement(visitId: string, organizationId: string) {
  const activeAssignments = await prisma.visitAssignment.findMany({
    where: { visitId, organizationId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
    select: { status: true },
  })
  const allAcknowledged = activeAssignments.length > 0 && activeAssignments.every((item) => item.status === 'acknowledged')
  await prisma.visit.updateMany({
    where: { id: visitId, organizationId, status: { in: [...ACK_ELIGIBLE_VISIT_STATUSES] } },
    data: { status: allAcknowledged ? 'acknowledged' : 'dispatched' },
  })
  return activeAssignments.length
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const { id } = await params
  const parsed = acknowledgementSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })

  const assignment = await prisma.visitAssignment.findFirst({
    where: {
      visitId: id,
      userId: auth.user.id,
      organizationId: auth.user.organizationId,
      status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
      visit: { status: { notIn: ['cancelled', 'missed', 'completed'] } },
    },
    include: {
      visit: {
        include: {
          site: { include: { client: { select: { displayName: true } } } },
          job: {
            include: {
              defaultAssignees: { where: { userId: auth.user.id }, select: { userId: true } },
            },
          },
        },
      },
    },
  })
  if (!assignment) return NextResponse.json({ ok: false, error: 'Active assignment not found' }, { status: 404 })
  if (parsed.data.status === 'declined' && !parsed.data.reason?.trim()) {
    return NextResponse.json({ ok: false, error: 'Tell dispatch why you cannot take this visit.', code: 'DECLINE_REASON_REQUIRED' }, { status: 400 })
  }
  if (parsed.data.scope === 'recurring' && parsed.data.status !== 'acknowledged') {
    return NextResponse.json({ ok: false, error: 'Recurring scope can only be used to accept an ongoing assignment.' }, { status: 400 })
  }
  if (parsed.data.scope === 'recurring' && (!isRecurringAssignmentRule(assignment.visit.job.recurrence) || !assignment.visit.job.defaultAssignees.length)) {
    return NextResponse.json({ ok: false, error: 'This visit is not part of your recurring assignment.' }, { status: 409 })
  }

  const now = new Date()
  let updated = assignment
  let affectedVisits = 1

  if (parsed.data.scope === 'recurring') {
    const result = await prisma.$transaction(async (tx) => {
      await markRecurringCommitmentAccepted(tx, {
        organizationId: auth.user.organizationId,
        userId: auth.user.id,
        jobId: assignment.visit.jobId,
        visitId: assignment.visit.id,
        siteId: assignment.visit.siteId,
        createdById: auth.user.id,
        label: `${assignment.visit.site.client.displayName} · ${assignment.visit.site.name}`,
      })

      const future = await tx.visitAssignment.findMany({
        where: {
          organizationId: auth.user.organizationId,
          userId: auth.user.id,
          status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
          visit: {
            jobId: assignment.visit.jobId,
            status: { in: [...ACK_ELIGIBLE_VISIT_STATUSES] },
            scheduledEnd: { gte: now },
          },
        },
        select: { id: true, visitId: true },
      })
      const ids = future.map((item) => item.id)
      if (ids.length) {
        await tx.visitAssignment.updateMany({
          where: { id: { in: ids } },
          data: {
            status: 'acknowledged',
            seenAt: now,
            acknowledgedAt: now,
            declinedAt: null,
            declineReason: null,
          },
        })
      }
      return { visitIds: [...new Set(future.map((item) => item.visitId))] }
    })

    affectedVisits = result.visitIds.length
    for (const visitId of result.visitIds) await reconcileVisitAcknowledgement(visitId, auth.user.organizationId)
    updated = await prisma.visitAssignment.findUniqueOrThrow({
      where: { id: assignment.id },
      include: {
        visit: {
          include: {
            site: { include: { client: { select: { displayName: true } } } },
            job: { include: { defaultAssignees: { where: { userId: auth.user.id }, select: { userId: true } } } },
          },
        },
      },
    })
  } else {
    updated = await prisma.visitAssignment.update({
      where: { id: assignment.id },
      data: {
        status: parsed.data.status,
        seenAt: assignment.seenAt ?? now,
        acknowledgedAt: parsed.data.status === 'acknowledged' ? now : assignment.acknowledgedAt,
        declinedAt: parsed.data.status === 'declined' ? now : null,
        declineReason: parsed.data.status === 'declined' ? parsed.data.reason!.trim() : null,
      },
      include: {
        visit: {
          include: {
            site: { include: { client: { select: { displayName: true } } } },
            job: { include: { defaultAssignees: { where: { userId: auth.user.id }, select: { userId: true } } } },
          },
        },
      },
    })
    await reconcileVisitAcknowledgement(id, auth.user.organizationId)
  }

  if (parsed.data.status === 'declined') {
    const managers = await prisma.membership.findMany({
      where: {
        organizationId: auth.user.organizationId,
        status: 'active',
        role: { in: ['organization_admin', 'field_supervisor', 'scheduler'] },
        user: { status: 'active' },
      },
      select: { userId: true },
    })
    const userIds = [...new Set(managers.map((item) => item.userId).filter((userId) => userId !== auth.user.id))]
    if (userIds.length) {
      const notice = await prisma.operationalNotice.create({
        data: {
          organizationId: auth.user.organizationId,
          siteId: assignment.visit.siteId,
          visitId: id,
          type: 'schedule_change',
          priority: 'high',
          title: 'Cleaning assignment declined',
          body: `${auth.user.name ?? auth.user.email} declined ${assignment.visit.site.client.displayName} · ${assignment.visit.site.name} on ${assignment.visit.scheduledStart.toLocaleString('en-IE', { timeZone: assignment.visit.timezone })}. Reason: ${parsed.data.reason!.trim()}`,
          requiresAcknowledgement: false,
          createdById: auth.user.id,
          recipients: { create: userIds.map((userId) => ({ organizationId: auth.user.organizationId, userId })) },
        },
      })
      await enqueueNotification({
        organizationId: auth.user.organizationId,
        kind: 'operational_notice_push',
        createdBy: auth.user.email,
        entityType: 'operational_notice',
        entityId: notice.id,
        payload: { userIds, title: notice.title, body: notice.body, noticeId: notice.id, priority: notice.priority },
      })
    }
  }

  const activeCoverage = await prisma.visitAssignment.count({
    where: { visitId: id, organizationId: auth.user.organizationId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
  })
  await logAudit(auth.user.email, 'visit_assignment_response', 'visit_assignment', updated.id, {
    visitId: id,
    jobId: assignment.visit.jobId,
    status: updated.status,
    scope: parsed.data.scope,
    affectedVisits,
    reason: updated.declineReason,
    activeCoverage,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { ...updated, responseScope: parsed.data.scope, affectedVisits } })
}
