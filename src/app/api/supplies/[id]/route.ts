import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireAuth } from '../../../../lib/auth'
import { dbStatusToLabel } from '../../../../lib/mappers'
import { parseStringArray } from '../../../../lib/json'

export async function GET(request: NextRequest, context: { params: { id: string } }) {
  console.log('[API /api/supplies/:id GET]')
  const auth = await requireAuth(request, ['admin', 'supervisor'])
  if ('response' in auth) return auth.response

  const row = await prisma.supplyRequest.findUnique({ where: { id: context.params.id } })
  if (!row) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    data: { ...row, status: dbStatusToLabel(row.status), products: parseStringArray(row.products) },
  })
}
