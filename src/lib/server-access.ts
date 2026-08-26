import { cookies } from 'next/headers'
import type { Capability } from './permissions'
import { hasCapability } from './permissions'
import { prisma } from './prisma'
import { sessionCookie, verifySessionToken } from './session'

export async function currentMembershipAccess() {
  const session = await verifySessionToken((await cookies()).get(sessionCookie.name)?.value)
  if (!session) return null
  const membership = await prisma.membership.findFirst({
    where: { organizationId: session.organizationId, status: 'active', user: { email: session.email, status: 'active' } },
    include: { user: { select: { id: true, email: true, name: true } }, organization: { select: { id: true, name: true, timezone: true } }, capabilityGrants: true },
  })
  if (!membership) return null
  return {
    session,
    membership,
    can(capability: Capability) {
      return hasCapability({
        role: membership.role,
        capability,
        grants: membership.capabilityGrants.map((grant) => ({
          capability: grant.capability,
          scopeType: grant.scopeType,
          scopeId: grant.scopeId,
        })),
      })
    },
  }
}

export async function currentUserCan(capability: Capability) {
  return (await currentMembershipAccess())?.can(capability) ?? false
}
