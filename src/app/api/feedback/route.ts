import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { CLIENT_LOCATIONS } from '../../../lib/constants'
import { calculateOverall, getCategoryLabel, isValidRating } from '../../../lib/business-logic'
import { requireAuth } from '../../../lib/auth'
import { sendFeedbackNotification } from '../../../lib/email'

const schema = z.object({
  employeeName: z.string().min(1),
  clientLocation: z.enum(CLIENT_LOCATIONS),
  cleanliness: z.number(),
  punctuality: z.number(),
  equipment: z.number(),
  clientRelations: z.number(),
  comments: z.string().optional(),
})

export async function POST(request: NextRequest) {
  console.log('[API /api/feedback POST]')
  const auth = await requireAuth(request, ['admin', 'supervisor'])
  if ('response' in auth) return auth.response

  const parsed = schema.safeParse(await request.json().catch(() => null))
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
      category: category.replace(' ', '') as 'Excellent' | 'VeryGood' | 'Good' | 'Fair' | 'Poor',
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

  const where = auth.user.role === 'supervisor' ? { submittedBy: auth.user.email } : undefined
  const items = await prisma.feedbackEntry.findMany({ where, orderBy: { createdAt: 'desc' } })

  return NextResponse.json({ ok: true, data: { total: items.length, items } })
}
