import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '../../../../../lib/auth'
import { prisma } from '../../../../../lib/prisma'
import { ownAssignedVisitFilter } from '../../../../../modules/execution/access'

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

/**
 * Fast personal projection for Today / Schedule / Time.
 *
 * The full /api/sync snapshot intentionally carries checklist, evidence,
 * incidents, areas and location-event history so a Visit can execute offline.
 * Loading all of that before rendering the tab shell is unnecessary. This
 * endpoint returns only the fields the personal tab workspace needs; the full
 * offline pack is refreshed separately after the UI is interactive.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'visits.execute')
  if ('response' in auth) return auth.response

  const parsed = querySchema.safeParse({
    from: request.nextUrl.searchParams.get('from') ?? undefined,
    to: request.nextUrl.searchParams.get('to') ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid visit window' }, { status: 400 })

  const from = parsed.data.from ?? new Date(Date.now() - 24 * 60 * 60 * 1000)
  const to = parsed.data.to ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  if (to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ ok: false, error: 'Visit window cannot exceed 31 days.' }, { status: 400 })
  }

  const visits = await prisma.visit.findMany({
    where: {
      organizationId: auth.user.organizationId,
      scheduledStart: { gte: from, lte: to },
      ...ownAssignedVisitFilter(auth.user),
      status: { notIn: ['cancelled', 'missed'] },
    },
    select: {
      id: true,
      status: true,
      scheduledStart: true,
      scheduledEnd: true,
      timezone: true,
      requiredWorkers: true,
      completedAt: true,
      site: {
        select: {
          id: true,
          name: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          postalCode: true,
          timezone: true,
          client: { select: { id: true, displayName: true } },
        },
      },
      job: { select: { id: true, name: true } },
      assignments: {
        where: { userId: auth.user.id },
        select: {
          id: true,
          status: true,
          declineReason: true,
          seenAt: true,
          acknowledgedAt: true,
          declinedAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
      timeEntries: {
        where: { userId: auth.user.id },
        select: {
          id: true,
          kind: true,
          status: true,
          startedAt: true,
          endedAt: true,
          durationSeconds: true,
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { startedAt: 'desc' },
      },
    },
    orderBy: { scheduledStart: 'asc' },
  })

  return NextResponse.json({ ok: true, data: visits })
}
