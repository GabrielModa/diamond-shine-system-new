import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'
import { issueAuthToken } from '../../../../lib/auth-tokens'
import { sendPasswordReset } from '../../../../lib/email'
import { consumeRateLimit, rateLimitKey } from '../../../../lib/rate-limit'

const bodySchema = z.object({ email: z.string().email() })
const genericResponse = { ok: true, data: { message: 'If the account exists, a reset link has been sent.' } }

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json(genericResponse)

  const email = parsed.data.email.trim().toLowerCase()
  const limitKey = await rateLimitKey('password-reset', request.headers, email)
  const rateLimit = await consumeRateLimit(limitKey, { limit: 3, windowSeconds: 60 * 60 })
  if (!rateLimit.allowed) {
    return NextResponse.json(genericResponse, { headers: { 'Retry-After': String(rateLimit.retryAfter) } })
  }

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || user.status === 'inactive') return NextResponse.json(genericResponse)

  const { token } = await issueAuthToken(user.id, 'password_reset')
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  const resetUrl = `${baseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`
  await sendPasswordReset({ to: user.email, name: user.name ?? user.email, resetUrl })

  return NextResponse.json(genericResponse)
}
