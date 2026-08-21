import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireAuth } from '../../../../lib/auth'
import { dbStatusToLabel } from '../../../../lib/mappers'
import { parseStringArray } from '../../../../lib/json'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  console.log('[API /api/supplies/:id GET]')
  const auth = await requireAuth(request, ['admin', 'supervisor'])
  if ('response' in auth) return auth.response

  const row = await prisma.supplyRequest.findUnique({
    where: { id },
    include: { items: true, statusEvents: { orderBy: { createdAt: 'asc' } } },
  })
  if (!row) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    data: {
      ...row,
      status: dbStatusToLabel(row.status as import('../../../../lib/mappers').DbSupplyStatus),
      products: parseStringArray(row.products),
      items: row.items.length
        ? row.items.map(({ product, quantity }) => ({ product, quantity }))
        : parseStringArray(row.products).map((product) => ({ product, quantity: 1 })),
      history: row.statusEvents.map((event) => ({
        ...event,
        toStatus: dbStatusToLabel(event.toStatus as import('../../../../lib/mappers').DbSupplyStatus),
        fromStatus: event.fromStatus
          ? dbStatusToLabel(event.fromStatus as import('../../../../lib/mappers').DbSupplyStatus)
          : null,
      })),
    },
  })
}
