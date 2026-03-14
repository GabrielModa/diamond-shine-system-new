import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { dbStatusToLabel, dbCategoryToLabel } from '../../../lib/mappers'
import { parseStringArray } from '../../../lib/json'

export async function GET(request: NextRequest) {
  console.log('[API /api/dashboard GET]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const [supplies, feedback] = await Promise.all([
    prisma.supplyRequest.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.feedbackEntry.findMany({ orderBy: { createdAt: 'desc' } }),
  ])

  const byStatus = {
    pending: supplies.filter((s) => s.status === 'Pending').length,
    emailSent: supplies.filter((s) => s.status === 'EmailSent').length,
    completed: supplies.filter((s) => s.status === 'Completed').length,
  }

  const pending = supplies.filter((s) => s.status === 'Pending')
  const byPriority = {
    urgent: pending.filter((s) => s.priority === 'urgent').length,
    normal: pending.filter((s) => s.priority === 'normal').length,
    low: pending.filter((s) => s.priority === 'low').length,
  }

  const productCounts: Record<string, number> = {}
  for (const req of supplies) {
    const products = parseStringArray(req.products)
    for (const product of products) {
      productCounts[product] = (productCounts[product] ?? 0) + 1
    }
  }

  const mostRequestedProduct = Object.entries(productCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''

  const feedbackTotal = feedback.length
  const averageOverall = feedbackTotal ? feedback.reduce((sum, f) => sum + f.overall, 0) / feedbackTotal : 0
  const excellentCount = feedback.filter((f) => f.overall >= 4.6).length

  return NextResponse.json({
    ok: true,
    data: {
      supplies: {
        total: supplies.length,
        byStatus,
        byPriority,
        mostRequestedProduct,
        recent: supplies.slice(0, 10).map((s) => ({
          ...s,
          status: dbStatusToLabel(s.status),
          products: parseStringArray(s.products),
        })),
      },
      feedback: {
        total: feedbackTotal,
        averageOverall,
        excellentCount,
        recent: feedback.slice(0, 10).map((f) => ({ ...f, category: dbCategoryToLabel(f.category) })),
      },
    },
  })
}
