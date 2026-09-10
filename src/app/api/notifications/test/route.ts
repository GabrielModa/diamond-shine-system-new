import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '../../../../lib/auth'
import { testEmailDelivery } from '../../../../lib/email-diagnostic'
import { prisma } from '../../../../lib/prisma'

export const runtime = 'nodejs'
export const maxDuration = 60

function firstValidEmail(value?: string | null) {
  for (const candidate of value?.split(',') ?? []) {
    const parsed = z.string().email().safeParse(candidate.trim())
    if (parsed.success) return parsed.data
  }
  return null
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  // Prefer the existing operational test override so production diagnostics hit
  // the explicitly configured test inbox. Fall back to the authenticated admin
  // email without accepting arbitrary request input, so this cannot become a relay.
  const setting = await prisma.notificationSetting.findUnique({
    where: {
      organizationId_key: {
        organizationId: auth.user.organizationId,
        key: 'operational_email_override',
      },
    },
    select: { recipients: true },
  }).catch(() => null)

  const recipient = firstValidEmail(setting?.recipients) ?? firstValidEmail(auth.user.email)
  if (!recipient) {
    return NextResponse.json({ ok: false, error: 'Configure a valid operational test inbox or account email first.' }, { status: 400 })
  }

  const result = await testEmailDelivery(recipient)
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 502 })
  return NextResponse.json({ ok: true, data: { message: result.message, recipient } })
}
