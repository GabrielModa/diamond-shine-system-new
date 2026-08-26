import type { Prisma } from '@prisma/client'
import type { AuthUser } from '../../lib/auth'
import { ACTIVE_ASSIGNMENT_STATUSES, NON_OPERATIONAL_VISIT_STATUSES } from '../scheduling/assignment-lifecycle'

export function assignedVisitFilter(user: AuthUser): Prisma.VisitWhereInput {
  return user.membershipRole === 'employee'
    ? {
        status: { notIn: [...NON_OPERATIONAL_VISIT_STATUSES] },
        assignments: {
          some: {
            userId: user.id,
            status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] },
          },
        },
      }
    : {}
}

export function canManageTeamTime(user: AuthUser) {
  return user.membershipRole === 'organization_admin' || user.membershipRole === 'field_supervisor'
}
