import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../lib/auth'
import { prisma } from '../../../../lib/prisma'
import { materialState } from '../../../../modules/materials/catalog'

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'supplies.manage')
  if ('response' in auth) return auth.response
  const [levels, requests, sitesWithoutCount] = await Promise.all([
    prisma.siteStockLevel.findMany({
      where: { organizationId: auth.user.organizationId },
      include: { site: { include: { client: true } }, catalogItem: true },
      orderBy: [{ site: { name: 'asc' } }, { catalogItem: { name: 'asc' } }],
    }),
    prisma.supplyRequest.findMany({
      where: { organizationId: auth.user.organizationId, status: { in: ACTIVE_REQUEST_STATUSES } },
      include: { site: true, items: true, statusEvents: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.site.count({
      where: { organizationId: auth.user.organizationId, archivedAt: null, stockLevels: { none: {} } },
    }),
  ])
  const now = new Date()
  const mappedLevels = levels.map((level) => ({
    ...level,
    state: materialState(level),
    daysRemaining: level.estimatedDailyUse && Number(level.estimatedDailyUse) > 0
      ? Math.round((level.onHand / Number(level.estimatedDailyUse)) * 10) / 10
      : null,
  }))
  return NextResponse.json({
    ok: true,
    data: {
      summary: {
        tracked: levels.length,
        outOfStock: mappedLevels.filter((level) => level.state === 'out').length,
        needsReorder: mappedLevels.filter((level) => level.state === 'reorder').length,
        openRequests: requests.length,
        overdueRequests: requests.filter((item) => item.dueAt && item.dueAt < now).length,
        sitesWithoutCount,
      },
      levels: mappedLevels,
      requests,
    },
  })
}

const ACTIVE_REQUEST_STATUSES = ['Requested', 'Triaged', 'Approved', 'Ordered', 'InTransit']
