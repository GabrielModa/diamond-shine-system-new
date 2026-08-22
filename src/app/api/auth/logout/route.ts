import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { sessionCookie, verifySessionToken } from '../../../../lib/session'

function clearAuthCookies(response: NextResponse) {
  const isProd = process.env.NODE_ENV === 'production'
  response.cookies.set(sessionCookie.name, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: isProd,
  })
}

export async function POST(request: NextRequest) {
  console.log('[API /api/auth/logout POST]')
  const authorization = request.headers.get('authorization')
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined
  const session = await verifySessionToken(bearerToken || request.cookies.get(sessionCookie.name)?.value)
  if (session?.sessionId) {
    await prisma.mobileSession.updateMany({
      where: { id: session.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  }
  const response = bearerToken
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL('/login', request.url), { status: 303 })
  clearAuthCookies(response)
  return response
}

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', request.url), { status: 303 })
  clearAuthCookies(response)
  return response
}
