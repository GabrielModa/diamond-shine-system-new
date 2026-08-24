import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { setPasswordWithAuthToken } from '../../../../lib/auth-tokens'

const bodySchema = z.object({
  token: z.string().min(20),
  password: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/),
})

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Use at least 12 characters with uppercase, lowercase, and a number.' },
      { status: 400 }
    )
  }

  const user = await setPasswordWithAuthToken(parsed.data.token, 'password_reset', parsed.data.password)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'This reset link is invalid or has expired.' }, { status: 400 })
  }
  return NextResponse.json({ ok: true, data: { reset: true } })
}
