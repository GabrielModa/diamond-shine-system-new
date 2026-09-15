import { NextRequest, NextResponse } from 'next/server'
import { authUserHasCapability, getAuthUser } from '../../../../lib/auth'
import { prisma } from '../../../../lib/prisma'

async function loadMine(organizationId: string, userId: string) {
  const notices = await prisma.operationalNotice.findMany({
    where: { organizationId, recipients: { some: { userId } } },
    include: {
      site: { select: { id: true, name: true, client: { select: { displayName: true } } } },
      visit: { select: { id: true, scheduledStart: true, status: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      recipients: {
        where: { userId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { deliveredAt: 'asc' },
      },
    },
    orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }],
    take: 100,
  })
  const received = notices.map((notice) => notice.recipients[0]).filter(Boolean)
  return {
    items: notices,
    summary: {
      total: notices.length,
      unread: received.filter((item) => !item.seenAt).length,
      awaitingAcknowledgement: notices.filter((notice) => notice.requiresAcknowledgement && !notice.recipients[0]?.acknowledgedAt).length,
      critical: notices.filter((notice) => notice.priority === 'critical').length,
    },
  }
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const canManage = authUserHasCapability(user, 'communications.manage')
  const [mine, memberships, sites, operationalEmailOverride] = await Promise.all([
    loadMine(user.organizationId, user.id),
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
    canManage ? prisma.notificationSetting.findUnique({
      where: {
        organizationId_key: {
          organizationId: user.organizationId,
          key: 'operational_email_override',
        },
      },
      select: { recipients: true },
    }) : Promise.resolve(null),
  ])

  return NextResponse.json({
    ok: true,
    data: {
      mine,
      all: null,
      people: memberships.map((membership) => ({ ...membership.user, role: membership.role })),
      sites,
      canManage,
      operationalEmailOverrideActive: Boolean(operationalEmailOverride?.recipients.trim()),
    },
  })
}
