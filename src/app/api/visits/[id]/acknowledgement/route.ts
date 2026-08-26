import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { enqueueNotification } from '../../../../../lib/notification-queue'
import { acknowledgementSchema } from '../../../../../modules/scheduling/schemas'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../../../modules/scheduling/assignment-lifecycle'

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
    include: { visit: { include: { site: { include: { client: { select: { displayName: true } } } } } } },
  })
  if (!assignment) return NextResponse.json({ ok: false, error: 'Active assignment not found' }, { status: 404 })
  if (parsed.data.status === 'declined' && !parsed.data.reason?.trim()) {
    return NextResponse.json({ ok: false, error: 'Tell dispatch why you cannot take this visit.', code: 'DECLINE_REASON_REQUIRED' }, { status: 400 })
  }

  const now = new Date()
  const updated = await prisma.visitAssignment.update({
    where: { id: assignment.id },
    data: {
      status: parsed.data.status,
      seenAt: assignment.seenAt ?? now,
      acknowledgedAt: parsed.data.status === 'acknowledged' ? now : assignment.acknowledgedAt,
      declinedAt: parsed.data.status === 'declined' ? now : null,
      declineReason: parsed.data.status === 'declined' ? parsed.data.reason!.trim() : null,
    },
  })

  const activeAssignments = await prisma.visitAssignment.findMany({
    where: { visitId: id, organizationId: auth.user.organizationId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
    select: { status: true },
  })
  const allAcknowledged = activeAssignments.length > 0 && activeAssignments.every((item) => item.status === 'acknowledged')
  if (['scheduled', 'dispatched', 'acknowledged'].includes(assignment.visit.status)) {
    await prisma.visit.updateMany({
      where: { id, status: { in: ['scheduled', 'dispatched', 'acknowledged'] } },
      data: { status: allAcknowledged ? 'acknowledged' : 'dispatched' },
    })
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

  await logAudit(auth.user.email, 'visit_assignment_response', 'visit_assignment', updated.id, {
    visitId: id,
    status: updated.status,
    reason: updated.declineReason,
    activeCoverage: activeAssignments.length,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: updated })
}
