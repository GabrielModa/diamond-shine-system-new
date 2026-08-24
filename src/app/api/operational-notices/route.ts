import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireAuth, requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { operationalNoticeCreateSchema, operationalNoticeQuerySchema } from '../../../modules/communications/schemas'
import { enqueueNotification } from '../../../lib/notification-queue'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, ['admin', 'supervisor', 'employee'])
  if ('response' in auth) return auth.response
  const parsed = operationalNoticeQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  const organizationId = auth.user.organizationId
  if (parsed.data.scope === 'all') {
    const manager = await requireCapability(request, 'communications.manage')
    if ('response' in manager) return manager.response
  }
  const mine = parsed.data.scope === 'mine'
  const notices = await prisma.operationalNotice.findMany({
    where: {
      organizationId,
      ...(mine ? {
        recipients: {
          some: {
            userId: auth.user.id,
            ...(parsed.data.state === 'unread' ? { seenAt: null } : {}),
            ...(parsed.data.state === 'unacknowledged' ? { acknowledgedAt: null } : {}),
          },
        },
      } : {}),
    },
    include: {
      site: { select: { id: true, name: true, client: { select: { displayName: true } } } },
      visit: { select: { id: true, scheduledStart: true, status: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      recipients: {
        ...(mine ? { where: { userId: auth.user.id } } : {}),
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { deliveredAt: 'asc' },
      },
    },
    orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }],
    take: parsed.data.limit,
  })
  const received = mine ? notices.map((notice) => notice.recipients[0]).filter(Boolean) : []
  return NextResponse.json({
    ok: true,
    data: {
      items: notices,
      summary: mine ? {
        total: notices.length,
        unread: received.filter((item) => !item.seenAt).length,
        awaitingAcknowledgement: notices.filter((notice) => notice.requiresAcknowledgement && !notice.recipients[0]?.acknowledgedAt).length,
        critical: notices.filter((notice) => notice.priority === 'critical').length,
      } : {
        total: notices.length,
        recipients: notices.reduce((sum, notice) => sum + notice.recipients.length, 0),
        seen: notices.reduce((sum, notice) => sum + notice.recipients.filter((item) => item.seenAt).length, 0),
        acknowledged: notices.reduce((sum, notice) => sum + notice.recipients.filter((item) => item.acknowledgedAt).length, 0),
      },
    },
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'communications.manage')
  if ('response' in auth) return auth.response
  const parsed = operationalNoticeCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }
  const organizationId = auth.user.organizationId
  const userIds = [...new Set(parsed.data.userIds)]
  const members = await prisma.membership.findMany({
    where: { organizationId, userId: { in: userIds }, status: 'active' },
    select: { userId: true },
  })
  if (members.length !== userIds.length) {
    return NextResponse.json({ ok: false, error: 'Every recipient must be active in this organization' }, { status: 400 })
  }
  if (parsed.data.siteId) {
    const site = await prisma.site.findFirst({ where: { id: parsed.data.siteId, organizationId, archivedAt: null }, select: { id: true } })
    if (!site) return NextResponse.json({ ok: false, error: 'Site not found' }, { status: 404 })
  }
  if (parsed.data.visitId) {
    const visit = await prisma.visit.findFirst({
      where: { id: parsed.data.visitId, organizationId, ...(parsed.data.siteId ? { siteId: parsed.data.siteId } : {}) },
      select: { id: true },
    })
    if (!visit) return NextResponse.json({ ok: false, error: 'Visit not found for this context' }, { status: 404 })
  }
  const created = await prisma.operationalNotice.create({
    data: {
      organizationId,
      siteId: parsed.data.siteId,
      visitId: parsed.data.visitId,
      type: parsed.data.type,
      priority: parsed.data.priority,
      title: parsed.data.title,
      body: parsed.data.body,
      requiresAcknowledgement: parsed.data.requiresAcknowledgement,
      createdById: auth.user.id,
      expiresAt: parsed.data.expiresAt,
      recipients: { create: userIds.map((userId) => ({ organizationId, userId })) },
    },
    include: {
      site: { select: { id: true, name: true, client: { select: { displayName: true } } } },
      recipients: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  })
  await logAudit(auth.user.email, 'publish_operational_notice', 'operational_notice', created.id, {
    type: created.type,
    priority: created.priority,
    recipientCount: created.recipients.length,
    siteId: created.siteId,
    visitId: created.visitId,
  }, organizationId)
  await enqueueNotification({
    organizationId,
    kind: 'operational_notice_push',
    createdBy: auth.user.email,
    entityType: 'operational_notice',
    entityId: created.id,
    payload: {
      userIds,
      title: created.title,
      body: created.body,
      noticeId: created.id,
      priority: created.priority,
    },
  })
  return NextResponse.json({ ok: true, data: created }, { status: 201 })
}
