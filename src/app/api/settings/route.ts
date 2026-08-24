import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'

const emailList = z.string().min(1).refine((value) => {
  const emails = value.split(',').map((email) => email.trim()).filter(Boolean)
  return emails.length > 0 && emails.every((email) => z.string().email().safeParse(email).success)
}, 'Invalid email list')

const updateSchema = z.object({
  supplyAlerts: emailList,
  feedbackAlerts: emailList,
})

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const items = await prisma.notificationSetting.findMany({
    where: { organizationId: auth.user.organizationId },
  })
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

  await prisma.$transaction([
    prisma.notificationSetting.upsert({
      where: {
        organizationId_key: {
          organizationId: auth.user.organizationId,
          key: 'supply_alerts',
        },
      },
      update: { recipients: parsed.data.supplyAlerts },
      create: {
        organizationId: auth.user.organizationId,
        key: 'supply_alerts',
        recipients: parsed.data.supplyAlerts,
      },
    }),
    prisma.notificationSetting.upsert({
      where: {
        organizationId_key: {
          organizationId: auth.user.organizationId,
          key: 'feedback_alerts',
        },
      },
      update: { recipients: parsed.data.feedbackAlerts },
      create: {
        organizationId: auth.user.organizationId,
        key: 'feedback_alerts',
        recipients: parsed.data.feedbackAlerts,
      },
    }),
  ])
  await logAudit(
    auth.user.email,
    'update_notification_recipients',
    'settings',
    undefined,
    undefined,
    auth.user.organizationId
  )

  return NextResponse.json({ ok: true, data: { ok: true } })
}
