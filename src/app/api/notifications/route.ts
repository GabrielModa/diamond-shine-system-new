import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const [items, counts] = await Promise.all([
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
  ])
  return NextResponse.json({
    ok: true,
    data: { items, counts: Object.fromEntries(counts.map((item) => [item.status, item._count._all])) },
  })
}
