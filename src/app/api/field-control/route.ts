import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '../../../lib/auth'
import { prisma } from '../../../lib/prisma'
import { operationalDayRange } from '../../../lib/operational-time'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../modules/scheduling/assignment-lifecycle'

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'visits.review')
  if ('response' in auth) return auth.response
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  const organizationId = auth.user.organizationId
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } })
  const fallback = operationalDayRange(new Date(), organization?.timezone ?? 'Europe/Dublin')
  const from = parsed.data.from ?? new Date(fallback.from)
  const to = parsed.data.to ?? new Date(fallback.to)
  const reviewFrom = new Date(from.getTime() - 7 * 86_400_000)
  const [visits, reviewEntries, visitReviews, activeTimers, incidents] = await Promise.all([
    prisma.visit.findMany({
      where: { organizationId, status: { notIn: ['cancelled', 'missed'] }, scheduledStart: { gte: from, lt: to } },
      include: {
        site: { select: { id: true, name: true, city: true, client: { select: { id: true, displayName: true } } } },
        job: { select: { id: true, name: true } },
        assignments: { where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } }, include: { user: { select: { id: true, name: true, email: true } } } },
        taskResults: { select: { status: true } },
        // Live-board attention only needs unresolved execution state. Historical reviewReason
        // remains on the TimeEntry audit record, but an approved entry must not keep a visit red forever.
        timeEntries: {
          where: { status: { in: ['running', 'needs_review'] } },
          select: { id: true, userId: true, status: true, startedAt: true, durationSeconds: true, startDistanceM: true, startLocationClass: true, reviewReason: true },
        },
        incidents: { where: { status: { notIn: ['resolved', 'closed'] } }, select: { id: true, category: true, severity: true, title: true, status: true, createdAt: true } },
        _count: { select: { evidenceAssets: true } },
      },
      orderBy: { scheduledStart: 'asc' },
      take: 300,
    }),
    prisma.timeEntry.findMany({
      where: {
        organizationId,
        startedAt: { gte: reviewFrom, lt: to },
        status: { not: 'running' },
        OR: [
          { status: 'needs_review' },
          { disputes: { some: { status: 'open' } } },
        ],
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        visit: { select: { id: true, site: { select: { name: true, client: { select: { displayName: true } } } } } },
        locationEvents: { orderBy: { capturedAt: 'asc' } },
        disputes: { where: { status: 'open' }, select: { id: true, reason: true, createdAt: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 100,
    }),
    prisma.visit.findMany({
      where: { organizationId, status: 'completed', completedAt: { gte: reviewFrom, lt: to } },
      include: {
        site: { select: { name: true, client: { select: { displayName: true } } } },
        taskResults: { select: { status: true } },
        evidenceAssets: { select: { id: true, kind: true, visibility: true } },
        incidents: { select: { id: true, status: true, severity: true } },
        reviews: { orderBy: { createdAt: 'desc' }, take: 1, include: { reviewer: { select: { id: true, name: true, email: true } } } },
      },
      orderBy: { completedAt: 'desc' },
      take: 100,
    }),
    prisma.timeEntry.findMany({
      where: { organizationId, status: 'running', kind: 'visit' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        visit: { select: { id: true, site: { select: { name: true, client: { select: { displayName: true } } } } } },
      },
      orderBy: { startedAt: 'asc' },
      take: 100,
    }),
    prisma.incident.findMany({
      where: { organizationId, status: { notIn: ['resolved', 'closed'] } },
      include: {
        reporter: { select: { id: true, name: true, email: true } },
        visit: { select: { id: true, scheduledStart: true, site: { select: { name: true, client: { select: { displayName: true } } } } } },
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    }),
  ])
  const pendingVisitReviews = visitReviews.filter((visit) => visit.reviews[0]?.decision !== 'approved')
  return NextResponse.json({
    ok: true,
    data: {
      range: { from, to },
      summary: {
        visits: visits.length,
        completed: visits.filter((visit) => visit.status === 'completed').length,
        inProgress: visits.filter((visit) => visit.status === 'in_progress').length,
        blocked: visits.filter((visit) => visit.status === 'completion_blocked').length,
        activeTimers: activeTimers.length,
        needsReview: reviewEntries.length + pendingVisitReviews.length,
        openIncidents: incidents.length,
        criticalIncidents: incidents.filter((incident) => incident.severity === 'critical').length,
      },
      visits,
      reviewEntries,
      visitReviews: pendingVisitReviews,
      activeTimers,
      incidents,
    },
  })
}
