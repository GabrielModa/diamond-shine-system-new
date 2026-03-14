import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'

export async function GET(request: NextRequest) {
  console.log('[API /api/dashboard GET]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const supplies = await prisma.supplyRequest.findMany()
  const feedback = await prisma.feedbackEntry.findMany()

  return NextResponse.json({
    ok: true,
    data: {
      supplies: { total: supplies.length },
      feedback: { total: feedback.length },
    },
  })
}
