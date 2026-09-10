import { sanitizeDeliveryError } from '../../../lib/delivery-error'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const [items, counts, latestFailure] = await Promise.all([
    prisma.notificationJob.findMany({
      where: { organizationId: auth.user.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.notificationJob.groupBy({
      by: ['status'],
      where: { organizationId: auth.user.organizationId },
      _count: { _all: true },
    }),
    prisma.notificationJob.findFirst({
      where: { organizationId: auth.user.organizationId, status: { in: ['failed', 'exhausted'] }, lastError: { not: null } },
      orderBy: { lastAttemptAt: 'desc' },
      select: { kind: true, lastError: true, lastAttemptAt: true },
    }),
  ])
  return NextResponse.json({
    ok: true,
    data: {
      latestFailure: latestFailure ? { ...latestFailure, lastError: sanitizeDeliveryError(latestFailure.lastError) } : null,
      items: items.map((item) => ({ ...item, lastError: item.lastError ? sanitizeDeliveryError(item.lastError) : null })),
      counts: Object.fromEntries(counts.map((item) => [item.status, item._count._all])),
    },
  })
}
