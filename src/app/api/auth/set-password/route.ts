import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { stageInvitePassword } from '../../../../lib/invite-setup'

const bodySchema = z.object({
  token: z.string().min(20),
  password: z
    .string()
    .min(12)
    .max(128)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/[0-9]/),
})

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Use at least 12 characters with uppercase, lowercase, and a number.' },
      { status: 400 },
    )
  }

  const result = await stageInvitePassword(parsed.data.token, parsed.data.password)
  if (!result) {
    return NextResponse.json({ ok: false, error: 'This invitation is invalid or has expired.' }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    data: {
      stage: result.stage,
      nextUrl: result.needsProfileSetup
        ? `/complete-profile?token=${encodeURIComponent(parsed.data.token)}`
        : '/login',
    },
  })
}
