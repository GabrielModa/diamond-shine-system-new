import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { dbStatusToLabel, dbCategoryToLabel } from '../../../lib/mappers'
import { parseStringArray } from '../../../lib/json'

export async function GET(request: NextRequest) {
  console.log('[API /api/dashboard GET]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const organizationId = auth.user.organizationId
  const [
    supplyStatusGroups,
    activePriorityGroups,
    recentSupplies,
    productGroups,
    legacySupplyProducts,
    feedbackAggregate,
    excellentCount,
    recentFeedback,
  ] = await Promise.all([
    prisma.supplyRequest.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: { _all: true },
    }),
    prisma.supplyRequest.groupBy({
      by: ['priority'],
      where: { organizationId, status: { notIn: ['Delivered', 'Rejected', 'Cancelled'] } },
      _count: { _all: true },
    }),
    prisma.supplyRequest.findMany({
      where: { organizationId },
      include: { items: true, statusEvents: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.supplyRequestItem.groupBy({
      by: ['product'],
      where: { request: { organizationId } },
      _sum: { quantity: true },
    }),
    // Legacy rows predate SupplyRequestItem. Fetch only their compact JSON
    // product field instead of hydrating every request and status history.
    prisma.supplyRequest.findMany({
      where: { organizationId, items: { none: {} } },
      select: { products: true },
    }),
    prisma.feedbackEntry.aggregate({
      where: { organizationId },
      _count: { _all: true },
      _avg: { overall: true },
    }),
    prisma.feedbackEntry.count({ where: { organizationId, overall: { gte: 4.6 } } }),
    prisma.feedbackEntry.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ])

  const byStatus = { requested: 0, triaged: 0, approved: 0, ordered: 0, inTransit: 0, delivered: 0, rejected: 0, cancelled: 0 }
  for (const group of supplyStatusGroups) {
    if (group.status === 'Requested') byStatus.requested = group._count._all
    if (group.status === 'Triaged') byStatus.triaged = group._count._all
    if (group.status === 'Approved') byStatus.approved = group._count._all
    if (group.status === 'Ordered') byStatus.ordered = group._count._all
    if (group.status === 'InTransit') byStatus.inTransit = group._count._all
    if (group.status === 'Delivered') byStatus.delivered = group._count._all
    if (group.status === 'Rejected') byStatus.rejected = group._count._all
    if (group.status === 'Cancelled') byStatus.cancelled = group._count._all
  }

  const supplyTotal = supplyStatusGroups.reduce((total, group) => total + group._count._all, 0)

  const byPriority = { urgent: 0, normal: 0, low: 0 }
  for (const group of activePriorityGroups) {
    byPriority[group.priority] = group._count._all
  }

  const productCounts = new Map(productGroups.map((group) => [group.product, group._sum.quantity ?? 0]))
  for (const legacy of legacySupplyProducts) {
    for (const product of parseStringArray(legacy.products)) {
      productCounts.set(product, (productCounts.get(product) ?? 0) + 1)
    }
  }
  let mostRequestedProduct = ''
  let mostRequestedCount = 0
  for (const [product, count] of productCounts) {
    if (count > mostRequestedCount) {
      mostRequestedProduct = product
      mostRequestedCount = count
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      supplies: {
        total: supplyTotal,
        byStatus,
        byPriority,
        mostRequestedProduct,
        recent: recentSupplies.map((item) => {
          const products = parseStringArray(item.products)
          return {
            ...item,
            status: dbStatusToLabel(item.status as import('../../../lib/mappers').DbSupplyStatus),
            products,
            items: item.items.length ? item.items.map(({ product, quantity }) => ({ product, quantity })) : products.map((product) => ({ product, quantity: 1 })),
            history: item.statusEvents.map((event) => ({
              ...event,
              toStatus: dbStatusToLabel(event.toStatus as import('../../../lib/mappers').DbSupplyStatus),
              fromStatus: event.fromStatus
                ? dbStatusToLabel(event.fromStatus as import('../../../lib/mappers').DbSupplyStatus)
                : null,
            })),
          }
        }),
      },
      feedback: {
        total: feedbackAggregate._count._all,
        averageOverall: feedbackAggregate._avg.overall ?? 0,
        excellentCount,
        recent: recentFeedback.map((item) => ({
          ...item,
          category: dbCategoryToLabel(item.category as 'Excellent' | 'VeryGood' | 'Good' | 'Fair' | 'Poor'),
        })),
      },
    },
  })
}
