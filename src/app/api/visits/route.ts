import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'

const querySchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), siteId: z.string().optional(), assigneeId: z.string().optional() })

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  const from = parsed.data.from ?? new Date(Date.now() - 7 * 86_400_000)
  const to = parsed.data.to ?? new Date(Date.now() + 35 * 86_400_000)
  const ownOnly = auth.user.membershipRole === 'employee'
  const visits = await prisma.visit.findMany({
    where: {
      organizationId: auth.user.organizationId,
      scheduledStart: { gte: from, lte: to },
      ...(parsed.data.siteId ? { siteId: parsed.data.siteId } : {}),
      ...(ownOnly ? { assignments: { some: { userId: auth.user.id, status: { not: 'removed' } } } } : parsed.data.assigneeId ? { assignments: { some: { userId: parsed.data.assigneeId, status: { not: 'removed' } } } } : {}),
    },
    orderBy: { scheduledStart: 'asc' },
    include: {
      site: { include: { client: { select: { id: true, displayName: true } } } },
      job: { select: { id: true, name: true } },
      servicePlanVersion: { select: { id: true, versionNumber: true } },
      assignments: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  })
  return NextResponse.json({ ok: true, data: visits })
}
