import type { AssignmentStatus, VisitStatus } from '@prisma/client'

/** Assignment states that still represent an operational commitment. */
export const ACTIVE_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  'assigned',
  'notified',
  'seen',
  'acknowledged',
] as const

/** Visit states that should not consume future coverage/capacity. */
export const NON_OPERATIONAL_VISIT_STATUSES: readonly VisitStatus[] = [
  'cancelled',
  'missed',
] as const

export function isActiveAssignmentStatus(status: AssignmentStatus | string) {
  return (ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(status)
}

export function isOperationalVisitStatus(status: VisitStatus | string) {
  return !(NON_OPERATIONAL_VISIT_STATUSES as readonly string[]).includes(status)
}

export function activeAssignmentCount<T extends { status: AssignmentStatus | string }>(assignments: T[]) {
  return assignments.filter((assignment) => isActiveAssignmentStatus(assignment.status)).length
}
