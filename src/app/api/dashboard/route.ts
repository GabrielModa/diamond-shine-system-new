import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { dbStatusToLabel, dbCategoryToLabel } from '../../../lib/mappers'
import { parseStringArray } from '../../../lib/json'

export async function GET(request: NextRequest) {
  console.log('[API /api/dashboard GET]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const supplies = await prisma.supplyRequest.findMany({ include: { items: true }, orderBy: { createdAt: 'desc' } })
  const feedback = await prisma.feedbackEntry.findMany({ orderBy: { createdAt: 'desc' } })

  const byStatus = { pending: 0, emailSent: 0, completed: 0 }
  const byPriority = { urgent: 0, normal: 0, low: 0 }
  const productCounts: Record<string, number> = {}

  for (const item of supplies) {
    if (item.status === 'Pending') byStatus.pending += 1
    if (item.status === 'EmailSent') byStatus.emailSent += 1
    if (item.status === 'Completed') byStatus.completed += 1

    if (item.status === 'Pending') {
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
            status: dbStatusToLabel(item.status as 'Pending' | 'EmailSent' | 'Completed' | 'Cancelled'),
            products,
            items: item.items.length ? item.items.map(({ product, quantity }) => ({ product, quantity })) : products.map((product) => ({ product, quantity: 1 })),
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
