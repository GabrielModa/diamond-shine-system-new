import { NextRequest, NextResponse } from 'next/server'
import { sessionCookie } from '../../../../lib/session'

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
  const response = NextResponse.redirect(new URL('/login', request.url), { status: 303 })
  clearAuthCookies(response)
  return response
}

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/login', request.url), { status: 303 })
  clearAuthCookies(response)
  return response
}
