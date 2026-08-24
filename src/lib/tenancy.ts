import type { MembershipRole, UserRole } from '@prisma/client'

export const LEGACY_ORGANIZATION_ID = 'org_legacy_diamond_shine'
export const LEGACY_ORGANIZATION_SLUG = 'diamond-shine'

export function legacyRoleToMembershipRole(role: UserRole): MembershipRole {
  if (role === 'admin') return 'organization_admin'
  if (role === 'supervisor') return 'field_supervisor'
  if (role === 'employee') return 'employee'
  return 'viewer'
}

export function membershipRoleToLegacyUserRole(role: MembershipRole): UserRole {
  if (role === 'organization_admin') return 'admin'
  if (role === 'field_supervisor' || role === 'scheduler' || role === 'quality_inspector') {
    return 'supervisor'
  }
  if (role === 'employee' || role === 'stock_controller') return 'employee'
  return 'viewer'
}
