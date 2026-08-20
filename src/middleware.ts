import { NextRequest, NextResponse } from 'next/server'
import type { UserRole } from './types'
import { sessionCookie, verifySessionToken } from './lib/session'

const routeRoles: Record<string, UserRole[]> = {
  '/home': ['admin', 'supervisor', 'employee', 'viewer'],
  '/supplies': ['admin', 'supervisor', 'employee'],
  '/my-requests': ['admin', 'supervisor', 'employee'],
  '/feedback': ['admin', 'supervisor'],
  '/dashboard': ['admin'],
  '/users': ['admin'],
  '/communications': ['admin'],
  '/audit': ['admin'],
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  const allowed = routeRoles[path]
  if (!allowed) return NextResponse.next()

  const session = await verifySessionToken(request.cookies.get(sessionCookie.name)?.value)
  if (!session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (!allowed.includes(session.role)) {
    return NextResponse.redirect(new URL('/forbidden', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/home', '/supplies', '/my-requests', '/feedback', '/dashboard', '/users', '/communications', '/audit'],
}
