import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '../../../../lib/prisma'
import { createSessionToken, sessionCookie } from '../../../../lib/session'
import { clearRateLimit, consumeRateLimit, rateLimitKey } from '../../../../lib/rate-limit'

const DUMMY_PASSWORD_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.yrJB7TiT.1rVZETPp1Yj3FQWjZJb0m6'

export async function POST(request: NextRequest) {
  console.log('[API /api/auth/login POST]')
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null
  if (!body?.email || !body?.password) {
    return NextResponse.json({ ok: false, error: 'Invalid credentials' }, { status: 400 })
  }

  const email = body.email.trim().toLowerCase()
  const limitKey = await rateLimitKey('login', request.headers, email)
  const rateLimit = await consumeRateLimit(limitKey, { limit: 5, windowSeconds: 15 * 60 })
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many sign-in attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }

  const user = await prisma.user.findUnique({ where: { email } })
  const valid = await bcrypt.compare(body.password, user?.password ?? DUMMY_PASSWORD_HASH)
  if (!user?.password || !valid) {
    return NextResponse.json({ ok: false, error: 'Incorrect email or password' }, { status: 401 })
  }
  if (user.status !== 'active') {
    return NextResponse.json({ ok: false, error: 'Account pending approval' }, { status: 403 })
  }

  await clearRateLimit(limitKey)

  const response = NextResponse.json({ ok: true, data: { email: user.email, role: user.role } })
  response.cookies.set(sessionCookie.name, await createSessionToken(user.email, user.role), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: sessionCookie.maxAge,
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}
