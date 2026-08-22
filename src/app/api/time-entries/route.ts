import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '../../../lib/auth'
import { prisma } from '../../../lib/prisma'

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(['running', 'completed', 'needs_review', 'approved', 'rejected']).optional(),
  userId: z.string().optional(),
})

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'time.team.review')
  if ('response' in auth) return auth.response
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  const from = parsed.data.from ?? new Date(Date.now() - 30 * 86_400_000)
  const to = parsed.data.to ?? new Date(Date.now() + 86_400_000)
  const entries = await prisma.timeEntry.findMany({
    where: {
      organizationId: auth.user.organizationId,
      startedAt: { gte: from, lte: to },
      status: parsed.data.status,
      userId: parsed.data.userId,
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      visit: {
        select: {
          id: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          site: { select: { id: true, name: true, client: { select: { id: true, displayName: true } } } },
        },
      },
      locationEvents: { orderBy: { capturedAt: 'asc' } },
    },
    orderBy: { startedAt: 'desc' },
    take: 500,
  })
  return NextResponse.json({ ok: true, data: entries })
}

