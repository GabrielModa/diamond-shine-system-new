import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { CLIENT_LOCATIONS } from '../../../lib/constants'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { calculateFeedbackTrend, calculateOverall, getCategoryLabel, isValidRating } from '../../../lib/business-logic'
import { enqueueNotification } from '../../../lib/notification-queue'
import { dbCategoryToLabel, labelToDbCategory } from '../../../lib/mappers'
import { logAudit } from '../../../lib/audit'

const bodySchema = z.object({
  employeeId: z.string().min(1),
  clientLocation: z.enum(CLIENT_LOCATIONS),
  cleanliness: z.number(),
  punctuality: z.number(),
  equipment: z.number(),
  clientRelations: z.number(),
  comments: z.string().max(1000).optional(),
})

const feedbackCategories = ['Excellent', 'Very Good', 'Good', 'Fair', 'Poor'] as const

const feedbackQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  query: z.string().trim().max(200).default(''),
  employee: z.string().trim().max(200).default(''),
  category: z.enum(feedbackCategories).optional(),
})

export async function POST(request: NextRequest) {
  console.log('[API /api/feedback POST]')
  const auth = await requireAuth(request, ['admin', 'supervisor'])
  if ('response' in auth) return auth.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const ratings = [
    parsed.data.cleanliness,
    parsed.data.punctuality,
    parsed.data.equipment,
    parsed.data.clientRelations,
  ]
  if (!ratings.every(isValidRating)) {
    return NextResponse.json({ ok: false, error: 'Invalid ratings' }, { status: 400 })
  }

  const employee = await prisma.user.findFirst({
    where: {
      id: parsed.data.employeeId,
      status: 'active',
      memberships: {
        some: {
          organizationId: auth.user.organizationId,
          role: 'employee',
          status: 'active',
        },
      },
    },
    select: { id: true, name: true, email: true },
  })
  if (!employee) {
    return NextResponse.json({ ok: false, error: 'Employee not found or inactive' }, { status: 400 })
  }

  const overall = calculateOverall(
    parsed.data.cleanliness,
    parsed.data.punctuality,
    parsed.data.equipment,
    parsed.data.clientRelations
  )
  const category = getCategoryLabel(overall)

  const created = await prisma.feedbackEntry.create({
    data: {
      organizationId: auth.user.organizationId,
      employeeId: employee.id,
      employeeName: employee.name ?? employee.email,
      clientLocation: parsed.data.clientLocation,
      cleanliness: parsed.data.cleanliness,
      punctuality: parsed.data.punctuality,
      equipment: parsed.data.equipment,
      clientRelations: parsed.data.clientRelations,
      overall,
      category: labelToDbCategory(category),
      comments: parsed.data.comments,
      submittedBy: auth.user.email,
    },
  })

  const notification = await enqueueNotification({
    organizationId: auth.user.organizationId,
    kind: 'feedback_alert',
    createdBy: auth.user.email,
    entityType: 'feedback',
    entityId: created.id,
    payload: {
    id: created.id,
    employeeName: created.employeeName,
    clientLocation: created.clientLocation,
    cleanliness: created.cleanliness,
    punctuality: created.punctuality,
    equipment: created.equipment,
    clientRelations: created.clientRelations,
    overall: created.overall,
    category,
    comments: created.comments ?? undefined,
    submittedBy: created.submittedBy,
    createdAt: created.createdAt.toISOString(),
    },
  })

  await logAudit(auth.user.email, 'create_feedback', 'feedback', created.id, {
    employeeName: created.employeeName,
    notificationJobId: notification.id,
  }, auth.user.organizationId)

  return NextResponse.json({ ok: true, data: { id: created.id, notificationQueued: true } }, { status: 201 })
}

export async function GET(request: NextRequest) {
  console.log('[API /api/feedback GET]')
  const auth = await requireAuth(request, ['admin', 'supervisor'])
  if ('response' in auth) return auth.response

  const parsed = feedbackQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (parsed.success === false) {
    return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  }

  const { page, pageSize, query, employee, category } = parsed.data
  const baseWhere: Prisma.FeedbackEntryWhereInput = {
    organizationId: auth.user.organizationId,
    ...(auth.user.role === 'supervisor' ? { submittedBy: auth.user.email } : {}),
  }

  const searchFilters: Prisma.FeedbackEntryWhereInput[] = query
    ? [
        { employeeName: { contains: query, mode: 'insensitive' } },
        { clientLocation: { contains: query, mode: 'insensitive' } },
        { comments: { contains: query, mode: 'insensitive' } },
      ]
    : []

  if (query) {
    const needle = query.toLowerCase()
    const matchingCategories = feedbackCategories
      .filter((value) => value.toLowerCase().includes(needle))
      .map(labelToDbCategory)
    if (matchingCategories.length > 0) searchFilters.push({ category: { in: matchingCategories } })
  }

  const where: Prisma.FeedbackEntryWhereInput = {
    ...baseWhere,
    ...(employee ? { employeeName: employee } : {}),
    ...(category ? { category: labelToDbCategory(category) } : {}),
    ...(searchFilters.length ? { OR: searchFilters } : {}),
  }
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
  const [total, items, aggregate, attention, employeeRows, employeeAggregates, latestEmployeeRows, trendRows] = await Promise.all([
    prisma.feedbackEntry.count({ where }),
    prisma.feedbackEntry.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.feedbackEntry.aggregate({
      where,
      _avg: { overall: true, cleanliness: true, punctuality: true, equipment: true, clientRelations: true },
    }),
    prisma.feedbackEntry.count({ where: { ...where, overall: { lt: 4 } } }),
    prisma.feedbackEntry.groupBy({
      by: ['employeeName'],
      where: baseWhere,
      orderBy: { employeeName: 'asc' },
    }),
    prisma.feedbackEntry.groupBy({
      by: ['employeeName'],
      where: baseWhere,
      _avg: { overall: true, cleanliness: true, punctuality: true, equipment: true, clientRelations: true },
      _count: { _all: true },
      orderBy: { employeeName: 'asc' },
    }),
    prisma.feedbackEntry.findMany({
      where: baseWhere,
      distinct: ['employeeName'],
      orderBy: [{ employeeName: 'asc' }, { createdAt: 'desc' }],
      select: { employeeName: true, clientLocation: true, createdAt: true },
    }),
    prisma.feedbackEntry.findMany({
      where: { ...baseWhere, createdAt: { gte: sixtyDaysAgo } },
      select: { overall: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const mapped = items.map((item) => ({
    ...item,
    category: dbCategoryToLabel(item.category as 'Excellent' | 'VeryGood' | 'Good' | 'Fair' | 'Poor'),
  }))
  const latestByEmployee = new Map(latestEmployeeRows.map((item) => [item.employeeName, item]))
  const employeeSummaries = employeeAggregates.map((item) => {
    const overall = item._avg.overall ?? 0
    const latest = latestByEmployee.get(item.employeeName)
    return {
      name: item.employeeName,
      evaluations: item._count._all,
      overall,
      category: getCategoryLabel(overall),
      cleanliness: item._avg.cleanliness ?? 0,
      punctuality: item._avg.punctuality ?? 0,
      equipment: item._avg.equipment ?? 0,
      clientRelations: item._avg.clientRelations ?? 0,
      latestLocation: latest?.clientLocation ?? null,
      latestAt: latest?.createdAt ?? null,
    }
  }).sort((a, b) => b.overall - a.overall || a.name.localeCompare(b.name))
  const trend = calculateFeedbackTrend(trendRows)

  return NextResponse.json({
    ok: true,
    data: {
      total,
      items: mapped,
      employees: employeeRows.map((item) => item.employeeName),
      metrics: {
        overall: aggregate._avg.overall ?? 0,
        cleanliness: aggregate._avg.cleanliness ?? 0,
        punctuality: aggregate._avg.punctuality ?? 0,
        equipment: aggregate._avg.equipment ?? 0,
        clientRelations: aggregate._avg.clientRelations ?? 0,
        attention,
      },
      employeeSummaries,
      trend,
      pagination: {
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        hasMore: page * pageSize < total,
      },
    },
  })
}
