import { NextRequest, NextResponse } from 'next/server'
import { authUserHasCapability, getAuthUser } from '../../../../lib/auth'
import { prisma } from '../../../../lib/prisma'

async function loadNotices(organizationId: string, userId: string, mine: boolean) {
  const notices = await prisma.operationalNotice.findMany({
    where: {
      organizationId,
      ...(mine ? { recipients: { some: { userId } } } : {}),
    },
    include: {
      site: { select: { id: true, name: true, client: { select: { displayName: true } } } },
      visit: { select: { id: true, scheduledStart: true, status: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      recipients: {
        ...(mine ? { where: { userId } } : {}),
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { deliveredAt: 'asc' },
      },
    },
    orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }],
    take: 100,
  })

  const received = mine ? notices.map((notice) => notice.recipients[0]).filter(Boolean) : []
  return {
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
  }
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const canManage = authUserHasCapability(user, 'communications.manage')
  const [mine, all, memberships, sites] = await Promise.all([
    loadNotices(user.organizationId, user.id, true),
    canManage ? loadNotices(user.organizationId, user.id, false) : Promise.resolve(null),
    canManage ? prisma.membership.findMany({
      where: {
        organizationId: user.organizationId,
        status: 'active',
        user: { status: 'active' },
      },
      orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
      select: {
        role: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }) : Promise.resolve([]),
    canManage ? prisma.site.findMany({
      where: { organizationId: user.organizationId, archivedAt: null },
      orderBy: [{ client: { displayName: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        client: { select: { displayName: true } },
      },
    }) : Promise.resolve([]),
  ])

  return NextResponse.json({
    ok: true,
    data: {
      mine,
      all,
      people: memberships.map((membership) => ({ ...membership.user, role: membership.role })),
      sites,
      canManage,
    },
  })
}
