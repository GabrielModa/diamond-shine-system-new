import type { MembershipRole, UserRole } from '@prisma/client'

export const LEGACY_ORGANIZATION_ID = 'org_legacy_diamond_shine'
export const LEGACY_ORGANIZATION_SLUG = 'diamond-shine'

export function legacyRoleToMembershipRole(role: UserRole): MembershipRole {
  if (role === 'admin') return 'organization_admin'
  if (role === 'supervisor') return 'field_supervisor'
  if (role === 'employee') return 'employee'
  return 'viewer'
}

