import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'

const updateSchema = z.object({
  supplyAlerts: z.string().min(1),
  feedbackAlerts: z.string().min(1),
})

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const items = await prisma.notificationSetting.findMany()
  const map = new Map(items.map((item) => [item.key, item.recipients]))

  return NextResponse.json({
    ok: true,
    data: {
      supplyAlerts: map.get('supply_alerts') ?? '',
      feedbackAlerts: map.get('feedback_alerts') ?? '',
    },
  })
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const parsed = updateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  await prisma.notificationSetting.upsert({
    where: { key: 'supply_alerts' },
    update: { recipients: parsed.data.supplyAlerts },
    create: { key: 'supply_alerts', recipients: parsed.data.supplyAlerts },
  })
  await prisma.notificationSetting.upsert({
    where: { key: 'feedback_alerts' },
    update: { recipients: parsed.data.feedbackAlerts },
    create: { key: 'feedback_alerts', recipients: parsed.data.feedbackAlerts },
  })

  return NextResponse.json({ ok: true, data: { ok: true } })
}
