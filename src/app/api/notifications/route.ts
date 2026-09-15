import { sanitizeDeliveryError } from '../../../lib/delivery-error'
import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response
  const visibleJobWhere: Prisma.NotificationJobWhereInput = {
    organizationId: auth.user.organizationId,
    ...(process.env.REMOTE_PUSH_ENABLED === 'true' ? {} : { kind: { not: 'operational_notice_push' } }),
  }

  const [items, counts, latestFailure] = await Promise.all([
    prisma.notificationJob.findMany({
      where: visibleJobWhere,
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.notificationJob.groupBy({
      by: ['status'],
      where: visibleJobWhere,
      _count: { _all: true },
    }),
    prisma.notificationJob.findFirst({
      where: { ...visibleJobWhere, status: { in: ['failed', 'exhausted'] }, lastError: { not: null } },
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
