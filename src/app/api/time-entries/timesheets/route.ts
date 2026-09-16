import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { authUserHasCapability, getAuthUser } from '../../../../lib/auth'
import { prisma } from '../../../../lib/prisma'

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(5).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  userId: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
  kind: z.enum(['all', 'visit', 'driving', 'office', 'supplies', 'break', 'general']).default('all'),
  status: z.enum(['all', 'recorded', 'needs_review', 'approved', 'rejected', 'running', 'challenge']).default('all'),
})

const entrySelect = {
  id: true,
  kind: true,
  status: true,
  startedAt: true,
  endedAt: true,
  durationSeconds: true,
  payableSeconds: true,
  startLocationClass: true,
  endLocationClass: true,
  reviewReason: true,
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
  disputes: {
    select: { id: true, reason: true, status: true, resolution: true, resolvedAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' as const },
  },
} satisfies Prisma.TimeEntrySelect

function filteredWhere(
  organizationId: string,
  selfUserId: string | null,
  from: Date,
  to: Date,
  data: z.infer<typeof querySchema>,
): Prisma.TimeEntryWhereInput {
  const and: Prisma.TimeEntryWhereInput[] = [{
    organizationId,
    startedAt: { gte: from, lte: to },
    ...(selfUserId ? { userId: selfUserId } : data.userId ? { userId: data.userId } : {}),
  }]

  if (data.kind !== 'all') and.push({ kind: data.kind })
  if (data.clientId) and.push({ visit: { is: { site: { clientId: data.clientId } } } })

  if (data.status === 'recorded') and.push({ status: 'completed' })
  else if (data.status === 'challenge') and.push({ disputes: { some: { status: 'open' } } })
  else if (data.status !== 'all') and.push({ status: data.status })

  if (data.search) {
    and.push({
      OR: [
        { id: { contains: data.search, mode: 'insensitive' } },
        { reviewReason: { contains: data.search, mode: 'insensitive' } },
        { user: { is: { OR: [
          { name: { contains: data.search, mode: 'insensitive' } },
          { email: { contains: data.search, mode: 'insensitive' } },
        ] } } },
        { visit: { is: { site: { OR: [
          { name: { contains: data.search, mode: 'insensitive' } },
          { client: { is: { displayName: { contains: data.search, mode: 'insensitive' } } } },
        ] } } } },
      ],
    })
  }

  return { AND: and }
}

function seconds(value: number | null | undefined) {
  return Math.max(0, value ?? 0)
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query', details: parsed.error.flatten() }, { status: 400 })

  const canReviewTeam = authUserHasCapability(user, 'time.team.review')
  if (user.membershipRole !== 'employee' && !canReviewTeam) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  const from = parsed.data.from ?? new Date(Date.now() - 30 * 86_400_000)
  const to = parsed.data.to ?? new Date(Date.now() + 86_400_000)
  if (to <= from || to.getTime() - from.getTime() > 366 * 86_400_000) {
    return NextResponse.json({ ok: false, error: 'Time-entry range is too large.' }, { status: 400 })
  }

  const selfUserId = user.membershipRole === 'employee' ? user.id : null
  const where = filteredWhere(user.organizationId, selfUserId, from, to, parsed.data)
  const periodWhere: Prisma.TimeEntryWhereInput = {
    organizationId: user.organizationId,
    startedAt: { gte: from, lte: to },
    ...(selfUserId ? { userId: selfUserId } : {}),
  }

  const { page, limit } = parsed.data
  const [
    total,
    items,
    recorded,
    approvedWithPayable,
    approvedLegacy,
    approvedDuration,
    pending,
    rejected,
    challengeCount,
    reviewCount,
    runningCount,
    blockedCount,
    employeeGroups,
    kindGroups,
    clients,
    payrollGroups,
    payrollLegacyApproved,
    payrollChallengeGroups,
    payrollExceptionGroups,
  ] = await Promise.all([
    prisma.timeEntry.count({ where }),
    prisma.timeEntry.findMany({
      where,
      select: entrySelect,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.timeEntry.aggregate({
      where: { AND: [where, { endedAt: { not: null } }] },
      _sum: { durationSeconds: true },
      _count: { _all: true },
    }),
    prisma.timeEntry.aggregate({
      where: { AND: [where, { status: 'approved', payableSeconds: { not: null } }] },
      _sum: { payableSeconds: true },
    }),
    prisma.timeEntry.aggregate({
      where: { AND: [where, { status: 'approved', payableSeconds: null }] },
      _sum: { durationSeconds: true },
    }),
    prisma.timeEntry.aggregate({
      where: { AND: [where, { status: 'approved' }] },
      _sum: { durationSeconds: true },
    }),
    prisma.timeEntry.aggregate({
      where: { AND: [where, { status: { in: ['completed', 'needs_review'] } }] },
      _sum: { durationSeconds: true },
      _count: { _all: true },
    }),
    prisma.timeEntry.aggregate({
      where: { AND: [where, { status: 'rejected' }] },
      _sum: { durationSeconds: true },
    }),
    prisma.timeEntry.count({ where: { AND: [where, { disputes: { some: { status: 'open' } } }] } }),
    prisma.timeEntry.count({ where: { AND: [where, { status: 'needs_review' }] } }),
    prisma.timeEntry.count({ where: { AND: [where, { status: 'running' }] } }),
    prisma.timeEntry.count({ where: { AND: [where, { OR: [
      { status: { in: ['completed', 'needs_review'] } },
      { disputes: { some: { status: 'open' } } },
    ] }] } }),
    prisma.timeEntry.groupBy({ by: ['userId'], where: periodWhere, _count: { _all: true } }),
    prisma.timeEntry.groupBy({ by: ['kind'], where: periodWhere, _count: { _all: true } }),
    prisma.client.findMany({
      where: {
        organizationId: user.organizationId,
        sites: { some: { visits: { some: { timeEntries: { some: periodWhere } } } } },
      },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    }),
    prisma.timeEntry.groupBy({
      by: ['userId', 'status'],
      where,
      _sum: { durationSeconds: true, payableSeconds: true },
      _count: { _all: true },
    }),
    prisma.timeEntry.groupBy({
      by: ['userId'],
      where: { AND: [where, { status: 'approved', payableSeconds: null }] },
      _sum: { durationSeconds: true },
    }),
    prisma.timeEntry.groupBy({
      by: ['userId'],
      where: { AND: [where, { disputes: { some: { status: 'open' } } }] },
      _count: { _all: true },
    }),
    prisma.timeEntry.groupBy({
      by: ['userId'],
      where: { AND: [where, { OR: [
        { status: 'needs_review' },
        { disputes: { some: { status: 'open' } } },
      ] }] },
      _count: { _all: true },
    }),
  ])

  const itemIds = items.map((entry) => entry.id)
  const [locationStats, locationReviewStats, facetUsers] = await Promise.all([
    itemIds.length ? prisma.locationEvent.groupBy({
      by: ['timeEntryId'],
      where: { organizationId: user.organizationId, timeEntryId: { in: itemIds } },
      _count: { _all: true },
      _max: { distanceM: true },
    }) : Promise.resolve([]),
    itemIds.length ? prisma.locationEvent.groupBy({
      by: ['timeEntryId'],
      where: {
        organizationId: user.organizationId,
        timeEntryId: { in: itemIds },
        classification: { in: ['suspicious', 'unavailable'] },
      },
      _count: { _all: true },
    }) : Promise.resolve([]),
    employeeGroups.length ? prisma.user.findMany({
      where: { id: { in: employeeGroups.map((item) => item.userId) } },
      select: { id: true, name: true, email: true },
    }) : Promise.resolve([]),
  ])

  const reviewByEntry = new Map(
    locationReviewStats
      .filter((item) => item.timeEntryId)
      .map((item) => [item.timeEntryId as string, item._count._all]),
  )
  const locationByEntry = new Map(
    locationStats
      .filter((item) => item.timeEntryId)
      .map((item) => [item.timeEntryId as string, {
        count: item._count._all,
        maxDistanceM: item._max.distanceM,
        needsReview: (reviewByEntry.get(item.timeEntryId as string) ?? 0) > 0,
      }]),
  )

  const approvedSeconds = seconds(approvedWithPayable._sum.payableSeconds) + seconds(approvedLegacy._sum.durationSeconds)
  const approvedRecordedSeconds = seconds(approvedDuration._sum.durationSeconds)
  const excludedSeconds = seconds(rejected._sum.durationSeconds) + Math.max(0, approvedRecordedSeconds - approvedSeconds)

  const facetUserById = new Map(facetUsers.map((item) => [item.id, item]))
  const employees = employeeGroups
    .map((group) => facetUserById.get(group.userId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))

  const payrollUserIds = [...new Set(payrollGroups.map((group) => group.userId))]
  const payrollUsers = payrollUserIds.length ? await prisma.user.findMany({
    where: { id: { in: payrollUserIds } },
    select: { id: true, name: true, email: true },
  }) : []
  const payrollUserById = new Map(payrollUsers.map((item) => [item.id, item]))
  const legacyApprovedByUser = new Map(payrollLegacyApproved.map((item) => [item.userId, seconds(item._sum.durationSeconds)]))
  const challengesByUser = new Map(payrollChallengeGroups.map((item) => [item.userId, item._count._all]))
  const exceptionsByUser = new Map(payrollExceptionGroups.map((item) => [item.userId, item._count._all]))

  const payrollRows = payrollUserIds.map((userId) => {
    const statusRows = payrollGroups.filter((group) => group.userId === userId)
    const byStatus = new Map(statusRows.map((group) => [group.status, group]))
    const approvedRow = byStatus.get('approved')
    const approvedPayable = seconds(approvedRow?._sum.payableSeconds) + (legacyApprovedByUser.get(userId) ?? 0)
    const approvedRecorded = seconds(approvedRow?._sum.durationSeconds)
    const rejectedRecorded = seconds(byStatus.get('rejected')?._sum.durationSeconds)
    const completedRecorded = seconds(byStatus.get('completed')?._sum.durationSeconds)
    const needsReviewRecorded = seconds(byStatus.get('needs_review')?._sum.durationSeconds)
    const recordedSeconds = statusRows
      .filter((row) => row.status !== 'running')
      .reduce((sum, row) => sum + seconds(row._sum.durationSeconds), 0)

    return {
      user: payrollUserById.get(userId) ?? { id: userId, name: null, email: 'Unknown user' },
      entries: statusRows.reduce((sum, row) => sum + row._count._all, 0),
      recordedSeconds,
      approvedSeconds: approvedPayable,
      excludedSeconds: rejectedRecorded + Math.max(0, approvedRecorded - approvedPayable),
      pendingSeconds: completedRecorded + needsReviewRecorded,
      challenges: challengesByUser.get(userId) ?? 0,
      needsReview: byStatus.get('needs_review')?._count._all ?? 0,
      exceptions: exceptionsByUser.get(userId) ?? 0,
      running: byStatus.get('running')?._count._all ?? 0,
    }
  }).sort((a, b) => (a.user.name || a.user.email).localeCompare(b.user.name || b.user.email))

  return NextResponse.json({
    ok: true,
    data: {
      items: items.map((entry) => ({
        ...entry,
        locationSummary: locationByEntry.get(entry.id) ?? { count: 0, maxDistanceM: null, needsReview: false },
        locationEvents: [],
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: {
        recordedSeconds: seconds(recorded._sum.durationSeconds),
        endedCount: recorded._count._all,
        approvedSeconds,
        pendingSeconds: seconds(pending._sum.durationSeconds),
        pendingCount: pending._count._all,
        challengeCount,
        reviewCount,
        runningCount,
        excludedSeconds,
        blockedCount,
      },
      facets: {
        employees,
        kinds: kindGroups.map((group) => group.kind).sort(),
        clients,
      },
      payrollRows,
    },
  })
}
