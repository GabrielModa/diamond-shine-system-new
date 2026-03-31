import { NextRequest, NextResponse } from 'next/server'

function clearAuthCookies(response: NextResponse) {
  const isProd = process.env.NODE_ENV === 'production'
  response.cookies.set('ds-auth', '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    secure: isProd,
  })
  response.cookies.set('ds-role', '', {
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
