import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { CLIENT_LOCATIONS } from '../../../lib/constants'
import { calculateOverall, getCategoryLabel, isValidRating } from '../../../lib/business-logic'
import { requireAuth } from '../../../lib/auth'
import { sendFeedbackNotification } from '../../../lib/email'
import { dbCategoryToLabel, labelToDbCategory } from '../../../lib/mappers'

const createSchema = z.object({
  employeeName: z.string().min(1),
  clientLocation: z.enum(CLIENT_LOCATIONS),
  cleanliness: z.number(),
  punctuality: z.number(),
  equipment: z.number(),
  clientRelations: z.number(),
  comments: z.string().optional(),
})

const querySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export async function POST(request: NextRequest) {
  console.log('[API /api/feedback POST]')
  const auth = await requireAuth(request, ['admin', 'supervisor'])
  if ('response' in auth) return auth.response

  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const ratings = [
    parsed.data.cleanliness,
    parsed.data.punctuality,
    parsed.data.equipment,
    parsed.data.clientRelations,
  ]

  if (!ratings.every((value) => isValidRating(value))) {
    return NextResponse.json({ ok: false, error: 'Invalid rating' }, { status: 400 })
  }

  const overall = calculateOverall(...ratings)
  const category = getCategoryLabel(overall)

  const created = await prisma.feedbackEntry.create({
    data: {
      employeeName: parsed.data.employeeName,
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

  void sendFeedbackNotification({
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
  })

  return NextResponse.json({ ok: true, data: { id: created.id } }, { status: 201 })
}

export async function GET(request: NextRequest) {
  console.log('[API /api/feedback GET]')
  const auth = await requireAuth(request, ['admin', 'supervisor'])
  if ('response' in auth) return auth.response

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  }

  const where: {
    submittedBy?: string
    OR?: Array<{ employeeName?: { contains: string }; clientLocation?: { contains: string } }>
  } = {}

  if (auth.user.role === 'supervisor') {
    where.submittedBy = auth.user.email
  }

  if (parsed.data.search) {
    where.OR = [
      { employeeName: { contains: parsed.data.search, mode: 'insensitive' } },
      { clientLocation: { contains: parsed.data.search, mode: 'insensitive' } },
    ]
  }

  const skip = (parsed.data.page - 1) * parsed.data.limit
  const [total, items] = await Promise.all([
    prisma.feedbackEntry.count({ where }),
    prisma.feedbackEntry.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: parsed.data.limit }),
  ])

  return NextResponse.json({
    ok: true,
    data: {
      total,
      page: parsed.data.page,
      limit: parsed.data.limit,
      items: items.map((item) => ({ ...item, category: dbCategoryToLabel(item.category) })),
    },
  })
}
