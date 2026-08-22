import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { dbStatusToLabel, dbCategoryToLabel } from '../../../lib/mappers'
import { parseStringArray } from '../../../lib/json'

export async function GET(request: NextRequest) {
  console.log('[API /api/dashboard GET]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const supplies = await prisma.supplyRequest.findMany({
    where: { organizationId: auth.user.organizationId },
    include: { items: true, statusEvents: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
  })
  const feedback = await prisma.feedbackEntry.findMany({
    where: { organizationId: auth.user.organizationId },
    orderBy: { createdAt: 'desc' },
  })

  const byStatus = { requested: 0, triaged: 0, approved: 0, ordered: 0, inTransit: 0, delivered: 0, rejected: 0, cancelled: 0 }
  const byPriority = { urgent: 0, normal: 0, low: 0 }
  const productCounts: Record<string, number> = {}

  for (const item of supplies) {
    if (item.status === 'Requested') byStatus.requested += 1
    if (item.status === 'Triaged') byStatus.triaged += 1
    if (item.status === 'Approved') byStatus.approved += 1
    if (item.status === 'Ordered') byStatus.ordered += 1
    if (item.status === 'InTransit') byStatus.inTransit += 1
    if (item.status === 'Delivered') byStatus.delivered += 1
    if (item.status === 'Rejected') byStatus.rejected += 1
    if (item.status === 'Cancelled') byStatus.cancelled += 1

    if (!['Delivered', 'Rejected', 'Cancelled'].includes(item.status)) {
      if (item.priority === 'urgent') byPriority.urgent += 1
      if (item.priority === 'normal') byPriority.normal += 1
      if (item.priority === 'low') byPriority.low += 1
    }

    const requestItems = item.items.length
      ? item.items
      : parseStringArray(item.products).map((product) => ({ product, quantity: 1 }))
    for (const requestItem of requestItems) {
      productCounts[requestItem.product] = (productCounts[requestItem.product] ?? 0) + requestItem.quantity
    }
  }

  let mostRequestedProduct = ''
  let maxCount = 0
  for (const [product, count] of Object.entries(productCounts)) {
    if (count > maxCount) {
      maxCount = count
      mostRequestedProduct = product
    }
  }

  const feedbackTotal = feedback.length
  const feedbackSum = feedback.reduce((sum, item) => sum + item.overall, 0)
  const averageOverall = feedbackTotal ? feedbackSum / feedbackTotal : 0
  const excellentCount = feedback.filter((item) => item.overall >= 4.6).length

  return NextResponse.json({
    ok: true,
    data: {
      supplies: {
        total: supplies.length,
        byStatus,
        byPriority,
        mostRequestedProduct,
        recent: supplies.slice(0, 5).map((item) => {
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
        total: feedbackTotal,
        averageOverall,
        excellentCount,
        recent: feedback.slice(0, 5).map((item) => ({
          ...item,
          category: dbCategoryToLabel(item.category as 'Excellent' | 'VeryGood' | 'Good' | 'Fair' | 'Poor'),
        })),
      },
    },
  })
}
