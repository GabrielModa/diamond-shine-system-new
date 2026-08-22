import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '../../../../lib/prisma'
import { createSessionToken, MOBILE_SESSION_TTL_SECONDS, sessionCookie } from '../../../../lib/session'
import { clearRateLimit, consumeRateLimit, rateLimitKey } from '../../../../lib/rate-limit'
import { membershipRoleToLegacyUserRole } from '../../../../lib/tenancy'

const DUMMY_PASSWORD_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.yrJB7TiT.1rVZETPp1Yj3FQWjZJb0m6'

export async function POST(request: NextRequest) {
  console.log('[API /api/auth/login POST]')
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string; mobile?: boolean; deviceName?: string } | null
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

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: {
        where: { status: 'active', organization: { status: 'active' } },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  })
  const valid = await bcrypt.compare(body.password, user?.password ?? DUMMY_PASSWORD_HASH)
  if (!user?.password || !valid) {
    return NextResponse.json({ ok: false, error: 'Incorrect email or password' }, { status: 401 })
  }
  const membership = user.memberships[0]
  if (user.status !== 'active' || !membership) {
    return NextResponse.json({ ok: false, error: 'Account pending approval' }, { status: 403 })
  }

  await clearRateLimit(limitKey)

  const role = membershipRoleToLegacyUserRole(membership.role)
  const mobileSession = body.mobile
    ? await prisma.mobileSession.create({
        data: {
          userId: user.id,
          organizationId: membership.organizationId,
          deviceName: body.deviceName?.trim().slice(0, 120) || null,
          expiresAt: new Date(Date.now() + MOBILE_SESSION_TTL_SECONDS * 1000),
        },
      })
    : null
  const tokenTtl = mobileSession ? MOBILE_SESSION_TTL_SECONDS : sessionCookie.maxAge
  const accessToken = await createSessionToken(user.email, role, membership.organizationId, {
    ttlSeconds: tokenTtl,
    sessionId: mobileSession?.id,
    audience: mobileSession ? 'mobile' : 'web',
  })
  const response = NextResponse.json({
    ok: true,
    data: {
      email: user.email,
      name: user.name,
      role,
      organizationId: membership.organizationId,
      ...(body.mobile ? {
        accessToken,
        expiresIn: tokenTtl,
        expiresAt: new Date(Date.now() + tokenTtl * 1000).toISOString(),
      } : {}),
    },
  })
  if (!body.mobile) {
    response.cookies.set(
      sessionCookie.name,
      accessToken,
      {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: sessionCookie.maxAge,
        secure: process.env.NODE_ENV === 'production',
      }
    )
  }
  return response
}
