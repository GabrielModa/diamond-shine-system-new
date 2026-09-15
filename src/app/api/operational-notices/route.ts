import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireAuth, requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { operationalNoticeCreateSchema, operationalNoticeQuerySchema } from '../../../modules/communications/schemas'
import { enqueueNotification } from '../../../lib/notification-queue'

export async function GET(request: NextRequest) {
  const parsed = operationalNoticeQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  const auth = parsed.data.scope === 'all'
    ? await requireCapability(request, 'communications.manage')
    : await requireAuth(request, ['admin', 'supervisor', 'employee'])
  if ('response' in auth) return auth.response

  const organizationId = auth.user.organizationId
  const mine = parsed.data.scope === 'mine'
  const where: Prisma.OperationalNoticeWhereInput = {
    organizationId,
    ...(parsed.data.priority !== 'all' ? { priority: parsed.data.priority } : {}),
    ...(parsed.data.q ? {
      OR: [
        { title: { contains: parsed.data.q, mode: 'insensitive' } },
        { body: { contains: parsed.data.q, mode: 'insensitive' } },
      ],
    } : {}),
    ...(mine ? {
      recipients: {
        some: {
          userId: auth.user.id,
          ...(parsed.data.state === 'unread' ? { seenAt: null } : {}),
          ...(parsed.data.state === 'unacknowledged' ? { acknowledgedAt: null } : {}),
        },
      },
    } : parsed.data.trackingState === 'awaiting' ? {
      requiresAcknowledgement: true,
      recipients: { some: { acknowledgedAt: null } },
    } : parsed.data.trackingState === 'complete' ? {
      requiresAcknowledgement: true,
      recipients: { none: { acknowledgedAt: null } },
    } : parsed.data.trackingState === 'informational' ? {
      requiresAcknowledgement: false,
    } : {}),
  }

  const skip = (parsed.data.page - 1) * parsed.data.limit
  const [notices, filteredTotal] = await Promise.all([
    prisma.operationalNotice.findMany({
      where,
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
      skip,
      take: parsed.data.limit,
    }),
    prisma.operationalNotice.count({ where }),
  ])

  const totalPages = Math.max(1, Math.ceil(filteredTotal / parsed.data.limit))
  const received = mine ? notices.map((notice) => notice.recipients[0]).filter(Boolean) : []

  let summary: Record<string, number>
  if (mine) {
    summary = {
      total: filteredTotal,
      unread: received.filter((item) => !item.seenAt).length,
      awaitingAcknowledgement: notices.filter((notice) => notice.requiresAcknowledgement && !notice.recipients[0]?.acknowledgedAt).length,
      critical: notices.filter((notice) => notice.priority === 'critical').length,
    }
  } else {
    const [total, awaiting, complete, informational, critical, recipients, seen, acknowledged] = await Promise.all([
      prisma.operationalNotice.count({ where: { organizationId } }),
      prisma.operationalNotice.count({ where: { organizationId, requiresAcknowledgement: true, recipients: { some: { acknowledgedAt: null } } } }),
      prisma.operationalNotice.count({ where: { organizationId, requiresAcknowledgement: true, recipients: { none: { acknowledgedAt: null } } } }),
      prisma.operationalNotice.count({ where: { organizationId, requiresAcknowledgement: false } }),
      prisma.operationalNotice.count({ where: { organizationId, priority: 'critical' } }),
      prisma.operationalNoticeRecipient.count({ where: { organizationId } }),
      prisma.operationalNoticeRecipient.count({ where: { organizationId, seenAt: { not: null } } }),
      prisma.operationalNoticeRecipient.count({ where: { organizationId, acknowledgedAt: { not: null } } }),
    ])
    summary = { total, awaiting, complete, informational, critical, recipients, seen, acknowledged }
  }

  return NextResponse.json({
    ok: true,
    data: {
      items: notices,
      summary,
      pagination: {
        page: parsed.data.page,
        limit: parsed.data.limit,
        total: filteredTotal,
        totalPages,
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
