import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { CLIENT_LOCATIONS } from '../../../lib/constants'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { calculateOverall, getCategoryLabel, isValidRating } from '../../../lib/business-logic'
import { sendFeedbackNotification } from '../../../lib/email'
import { dbCategoryToLabel, labelToDbCategory } from '../../../lib/mappers'
import { logAudit } from '../../../lib/audit'

const bodySchema = z.object({
  employeeName: z.string().min(1),
  clientLocation: z.enum(CLIENT_LOCATIONS),
  cleanliness: z.number(),
  punctuality: z.number(),
  equipment: z.number(),
  clientRelations: z.number(),
  comments: z.string().max(1000).optional(),
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

  const overall = calculateOverall(
    parsed.data.cleanliness,
    parsed.data.punctuality,
    parsed.data.equipment,
    parsed.data.clientRelations
  )
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

  await logAudit(auth.user.email, 'create_feedback', 'feedback', created.id, {
    employeeName: created.employeeName,
  })

  return NextResponse.json({ ok: true, data: { id: created.id } }, { status: 201 })
}

export async function GET(request: NextRequest) {
  console.log('[API /api/feedback GET]')
  const auth = await requireAuth(request, ['admin', 'supervisor'])
  if ('response' in auth) return auth.response

  const where = auth.user.role === 'supervisor' ? { submittedBy: auth.user.email } : {}
  const [total, items] = await Promise.all([
    prisma.feedbackEntry.count({ where }),
    prisma.feedbackEntry.findMany({ where, orderBy: { createdAt: 'desc' } }),
  ])

  const mapped = items.map((item) => ({
    ...item,
    category: dbCategoryToLabel(item.category as 'Excellent' | 'VeryGood' | 'Good' | 'Fair' | 'Poor'),
  }))

  return NextResponse.json({ ok: true, data: { total, items: mapped } })
}
