import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authUserHasCapability, getAuthUser } from '../../../lib/auth'
import { dbCategoryToLabel, dbStatusToLabel } from '../../../lib/mappers'
import { prisma } from '../../../lib/prisma'
import { buildScheduleHealth } from '../../../modules/scheduling/schedule-health'

const querySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
}).refine((value) => value.to > value.from, { message: 'Invalid operational range.' })

const OPEN_SUPPLY = ['Requested', 'Triaged', 'Approved', 'Ordered', 'InTransit'] as const
const OPEN_ACTION = ['verified', 'waived'] as const
const OPEN_INCIDENT = ['resolved', 'closed'] as const

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!authUserHasCapability(user, 'schedule.manage') && !authUserHasCapability(user, 'visits.review')) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid operational range.' }, { status: 400 })

  const organizationId = user.organizationId
  const now = new Date()
  const reviewFrom = new Date(now.getTime() - 30 * 86_400_000)
  const reviewTo = new Date(now.getTime() + 86_400_000)

  const [
    visitGroups,
    scheduleHealth,
    timeReview,
    awaitingTriage,
    urgentSupplies,
    recentSupplies,
    recentFeedback,
    openIncidents,
    criticalIncidents,
    recentIncidents,
    overdueActions,
    criticalActions,
  ] = await Promise.all([
    prisma.visit.groupBy({
      by: ['status'],
      where: {
        organizationId,
        scheduledStart: { gte: parsed.data.from, lt: parsed.data.to },
        status: { notIn: ['cancelled', 'missed'] },
      },
      _count: { _all: true },
    }),
    buildScheduleHealth({
      organizationId,
      from: parsed.data.from,
      to: parsed.data.to,
    }),
    prisma.timeEntry.count({
      where: {
        organizationId,
        startedAt: { gte: reviewFrom, lte: reviewTo },
        OR: [
          { status: 'needs_review' },
          { disputes: { some: { status: 'open' } } },
        ],
      },
    }),
    prisma.supplyRequest.count({
      where: { organizationId, status: 'Requested' },
    }),
    prisma.supplyRequest.count({
      where: { organizationId, status: { in: [...OPEN_SUPPLY] }, priority: 'urgent' },
    }),
    prisma.supplyRequest.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        createdAt: true,
        employeeName: true,
        clientLocation: true,
        status: true,
        priority: true,
      },
    }),
    prisma.feedbackEntry.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        createdAt: true,
        employeeName: true,
        clientLocation: true,
        overall: true,
        category: true,
      },
    }),
    prisma.incident.count({
      where: { organizationId, status: { notIn: [...OPEN_INCIDENT] } },
    }),
    prisma.incident.count({
      where: { organizationId, status: { notIn: [...OPEN_INCIDENT] }, severity: 'critical' },
    }),
    prisma.incident.findMany({
      where: { organizationId, status: { notIn: [...OPEN_INCIDENT] } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        createdAt: true,
        title: true,
        severity: true,
        status: true,
        visit: {
          select: {
            site: {
              select: {
                name: true,
                client: { select: { displayName: true } },
              },
            },
          },
        },
      },
    }),
    prisma.correctiveAction.count({
      where: {
        organizationId,
        status: { notIn: [...OPEN_ACTION] },
        dueAt: { lt: now },
      },
    }),
    prisma.correctiveAction.count({
      where: {
        organizationId,
        status: { notIn: [...OPEN_ACTION] },
        severity: 'critical',
      },
    }),
  ])

  const countFor = (status: string) => visitGroups.find((group) => group.status === status)?._count._all ?? 0
  const visitsToday = visitGroups.reduce((sum, group) => sum + group._count._all, 0)

  return NextResponse.json({
    ok: true,
    data: {
      generatedAt: now,
      summary: {
        visitsToday,
        inProgress: countFor('in_progress'),
        completed: countFor('completed'),
        schedulingIssues: scheduleHealth.summary.attention,
        timeReview,
        awaitingTriage,
        urgentSupplies,
        openIncidents,
        criticalIncidents,
        blockedVisits: countFor('completion_blocked'),
        overdueActions,
        criticalActions,
      },
      activity: {
        supplies: recentSupplies.map((item) => ({
          ...item,
          status: dbStatusToLabel(item.status as import('../../../lib/mappers').DbSupplyStatus),
        })),
        feedback: recentFeedback.map((item) => ({
          ...item,
          category: dbCategoryToLabel(item.category as 'Excellent' | 'VeryGood' | 'Good' | 'Fair' | 'Poor'),
        })),
        incidents: recentIncidents,
      },
    },
  })
}
