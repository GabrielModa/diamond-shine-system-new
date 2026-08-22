import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { membershipRoleToLegacyUserRole } from '../../../lib/tenancy'

const ALL_LEGACY_ROLES = ['admin', 'supervisor', 'employee', 'viewer'] as const

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, ALL_LEGACY_ROLES)
  if ('response' in auth) return auth.response

  const memberships = await prisma.membership.findMany({
    where: {
      userId: auth.user.id,
      status: 'active',
      organization: { status: 'active' },
    },
    orderBy: { organization: { name: 'asc' } },
    include: { organization: true },
  })

  return NextResponse.json({
    ok: true,
    data: memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      timezone: membership.organization.timezone,
      role: membershipRoleToLegacyUserRole(membership.role),
      membershipRole: membership.role,
      current: membership.organizationId === auth.user.organizationId,
    })),
  })
}
