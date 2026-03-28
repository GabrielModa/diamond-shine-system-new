import { NextResponse } from 'next/server'

export async function POST() {
  console.log('[API /api/auth/logout POST]')
  const response = NextResponse.json({ ok: true })
  response.cookies.set('ds-auth', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  response.cookies.set('ds-role', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return response
}
