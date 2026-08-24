import type { AuthUser } from '../../lib/auth'

export function assignedVisitFilter(user: AuthUser) {
  return user.membershipRole === 'employee'
    ? { assignments: { some: { userId: user.id, status: { not: 'removed' as const } } } }
    : {}
}

export function canManageTeamTime(user: AuthUser) {
  return user.membershipRole === 'organization_admin' || user.membershipRole === 'field_supervisor'
}

