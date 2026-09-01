import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { enqueueNotification } from '../../../../../lib/notification-queue'

const PENDING_ACK_STATUSES = ['assigned', 'notified', 'seen'] as const
const CLOSED_VISIT_STATUSES = new Set(['cancelled', 'completed', 'missed'])

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth.response

  const { id } = await params
  const visit = await prisma.visit.findFirst({
    where: { id, organizationId: auth.user.organizationId },
    include: {
      site: { include: { client: { select: { displayName: true } } } },
      assignments: {
        where: { status: { in: [...PENDING_ACK_STATUSES] } },
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  })

  if (!visit) return NextResponse.json({ ok: false, error: 'Visit not found' }, { status: 404 })
  if (CLOSED_VISIT_STATUSES.has(visit.status)) {
    return NextResponse.json({ ok: false, error: 'Closed visits cannot send acknowledgement reminders.' }, { status: 409 })
  }
  if (!visit.assignments.length) {
    return NextResponse.json({ ok: false, error: 'All assigned cleaners have already acknowledged this visit.' }, { status: 409 })
  }

  const userIds = visit.assignments.map((assignment) => assignment.userId)
  const remindedAt = new Date()
  const when = visit.scheduledStart.toLocaleString('en-IE', {
    timeZone: visit.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
  const title = 'Visit acknowledgement reminder'
  const body = `Please acknowledge your cleaning visit at ${visit.site.client.displayName} · ${visit.site.name} on ${when}. Open the visit to confirm you have received the assignment.`

  const notice = await prisma.$transaction(async (tx) => {
    await tx.visitAssignment.updateMany({
      where: { id: { in: visit.assignments.map((assignment) => assignment.id) }, status: 'assigned' },
      data: { status: 'notified', notifiedAt: remindedAt },
    })
    await tx.visitAssignment.updateMany({
      where: { id: { in: visit.assignments.map((assignment) => assignment.id) }, status: { in: ['notified', 'seen'] } },
      data: { notifiedAt: remindedAt },
    })
    return tx.operationalNotice.create({
      data: {
        organizationId: auth.user.organizationId,
        siteId: visit.siteId,
        visitId: visit.id,
        type: 'schedule_change',
        priority: 'high',
        title,
        body,
        requiresAcknowledgement: true,
        createdById: auth.user.id,
        recipients: { create: userIds.map((userId) => ({ organizationId: auth.user.organizationId, userId })) },
      },
    })
  })

  const job = await enqueueNotification({
    organizationId: auth.user.organizationId,
    kind: 'operational_notice_push',
    createdBy: auth.user.email,
    entityType: 'operational_notice',
    entityId: notice.id,
    payload: { userIds, title: notice.title, body: notice.body, noticeId: notice.id, priority: notice.priority },
  })

  await logAudit(auth.user.email, 'remind_visit_acknowledgement', 'visit', visit.id, {
    recipientCount: userIds.length,
    recipientIds: userIds,
    notificationJobId: job.id,
    remindedAt,
  }, auth.user.organizationId)

  return NextResponse.json({
    ok: true,
    data: { visitId: visit.id, reminded: userIds.length, notificationJobId: job.id },
  }, { status: 202 })
}
