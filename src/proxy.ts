import { NextRequest, NextResponse } from 'next/server'
import { sessionCookie, verifySessionToken } from './lib/session'

export async function proxy(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get(sessionCookie.name)?.value)
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-diamond-path', request.nextUrl.pathname)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/home', '/supplies', '/my-requests', '/feedback', '/dashboard', '/users', '/communications', '/audit'],
}
