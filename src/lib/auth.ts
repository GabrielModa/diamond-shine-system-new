import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './prisma'
import type { UserRole } from '../types'

export interface AuthUser {
  email: string
  role: UserRole
  name: string | null
}

function parseAuthEmail(request: NextRequest): string | null {
  return request.cookies.get('ds-auth')?.value ?? null
}

export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  const email = parseAuthEmail(request)
  if (!email) return null
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || user.status !== 'active') return null
  return { email: user.email, role: user.role as UserRole, name: user.name }
}

export async function requireAuth(
  request: NextRequest,
  allowedRoles: readonly UserRole[]
): Promise<{ user: AuthUser } | { response: NextResponse }> {
  const user = await getAuthUser(request)
  if (!user) {
    return { response: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!allowedRoles.includes(user.role)) {
    return { response: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) }
  }
  return { user }
}
