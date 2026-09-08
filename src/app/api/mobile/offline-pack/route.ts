import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '../../../../lib/auth'
import { prisma } from '../../../../lib/prisma'
import { ownAssignedVisitFilter } from '../../../../modules/execution/access'

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

/**
 * Personal execution pack for offline use.
 *
 * Unlike the hot-path visit summary, this includes the checklist and evidence
 * required to execute a visit offline. It intentionally excludes team-only and
 * review-only payload (other assignees, site areas and historical GPS events)
 * because those facts are not needed by the cleaner's offline workflow.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'visits.execute')
  if ('response' in auth) return auth.response

  const parsed = querySchema.safeParse({
    from: request.nextUrl.searchParams.get('from') ?? undefined,
    to: request.nextUrl.searchParams.get('to') ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid offline window' }, { status: 400 })

  const from = parsed.data.from ?? new Date(Date.now() - 24 * 60 * 60 * 1000)
  const to = parsed.data.to ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  if (to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ ok: false, error: 'Offline window cannot exceed 31 days.' }, { status: 400 })
  }

  const visits = await prisma.visit.findMany({
    where: {
      organizationId: auth.user.organizationId,
      scheduledStart: { gte: from, lte: to },
      ...ownAssignedVisitFilter(auth.user),
      status: { notIn: ['cancelled', 'missed'] },
    },
    include: {
      site: { include: { client: true } },
      assignments: {
        where: { userId: auth.user.id },
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      servicePlanVersion: { include: { tasks: { orderBy: { sortOrder: 'asc' } } } },
      taskResults: { include: { evidence: true, versionTask: true } },
      evidenceAssets: true,
      incidents: { orderBy: { createdAt: 'desc' } },
      timeEntries: {
        where: { userId: auth.user.id },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { startedAt: 'desc' },
      },
    },
    orderBy: { scheduledStart: 'asc' },
  })

  return NextResponse.json({
    ok: true,
    data: visits,
    serverTime: new Date().toISOString(),
    window: { from: from.toISOString(), to: to.toISOString() },
  })
}
