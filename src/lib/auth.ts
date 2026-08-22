import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './prisma'
import type { UserRole } from '../types'
import { sessionCookie, verifySessionToken } from './session'
import type { Capability, PermissionScope } from './permissions'
import { hasCapability } from './permissions'
import { LEGACY_ORGANIZATION_ID } from './tenancy'

export interface AuthUser {
  id: string
  email: string
  role: UserRole
  name: string | null
  organizationId: string
  membershipId: string
  membershipRole: import('@prisma/client').MembershipRole
  capabilityGrants: Array<{
    capability: string
    scopeType: import('@prisma/client').ScopeType
    scopeId: string
  }>
}

export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  const session = await verifySessionToken(request.cookies.get(sessionCookie.name)?.value)
  if (!session) return null
  const user = await prisma.user.findUnique({
    where: { email: session.email },
    include: {
      memberships: {
        where: { organizationId: LEGACY_ORGANIZATION_ID, status: 'active' },
        include: { capabilityGrants: true },
        take: 1,
      },
    },
  })
  if (!user || user.status !== 'active') return null
  const membership = user.memberships[0]
  if (!membership) return null
  return {
    id: user.id,
    email: user.email,
    role: user.role as UserRole,
    name: user.name,
    organizationId: membership.organizationId,
    membershipId: membership.id,
    membershipRole: membership.role,
    capabilityGrants: membership.capabilityGrants.map((grant) => ({
      capability: grant.capability,
      scopeType: grant.scopeType,
      scopeId: grant.scopeId,
    })),
  }
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

export async function requireCapability(
  request: NextRequest,
  capability: Capability,
  requestedScope?: PermissionScope
): Promise<{ user: AuthUser } | { response: NextResponse }> {
  const user = await getAuthUser(request)
  if (!user) {
    return { response: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!hasCapability({
    role: user.membershipRole,
    capability,
    requestedScope,
    grants: user.capabilityGrants,
  })) {
    return { response: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) }
  }
  return { user }
}
