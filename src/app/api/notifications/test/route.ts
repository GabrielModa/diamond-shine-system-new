import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '../../../../lib/auth'
import { testEmailDelivery } from '../../../../lib/email-diagnostic'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response
  // The authenticated account is the only destination. Request input cannot
  // turn this administrative diagnostic into an arbitrary email relay.
  const recipient = z.string().email().safeParse(auth.user.email)
  if (!recipient.success) return NextResponse.json({ ok: false, error: 'Your account needs a valid email address.' }, { status: 400 })
  const result = await testEmailDelivery(recipient.data)
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 502 })
  return NextResponse.json({ ok: true, data: { message: result.message } })
}
