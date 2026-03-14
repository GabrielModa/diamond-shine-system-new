import { NextRequest, NextResponse } from 'next/server'

const routeRoles: Record<string, string[]> = {
  '/home': ['admin', 'supervisor', 'employee', 'viewer'],
  '/supplies': ['admin', 'supervisor', 'employee'],
  '/feedback': ['admin', 'supervisor'],
  '/dashboard': ['admin'],
}

function roleFromEmail(email: string): string {
  if (email.startsWith('admin@')) return 'admin'
  if (email.startsWith('super@')) return 'supervisor'
  if (email.startsWith('employee@')) return 'employee'
  return 'viewer'
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  const allowed = routeRoles[path]
  if (!allowed) return NextResponse.next()

  const email = request.cookies.get('ds-auth')?.value
  if (!email) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const role = roleFromEmail(email)
  if (!allowed.includes(role)) {
    return NextResponse.redirect(new URL('/forbidden', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/home', '/supplies', '/feedback', '/dashboard'],
}
