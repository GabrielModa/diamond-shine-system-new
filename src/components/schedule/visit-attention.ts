import { isActiveAssignmentStatus, isOperationalVisitStatus } from '../../modules/scheduling/assignment-lifecycle'

type AttentionVisit = { status: string; requiredWorkers: number; assignments: Array<{ status: string; user: { id: string } }> }

/** Status, not the selected filter, determines a visit's operational treatment. */
export function visitAttention(visit: AttentionVisit, conflicted: boolean, employeeId: string | null = null) {
  const active = visit.assignments.filter((assignment) => isActiveAssignmentStatus(assignment.status))
  const operational = isOperationalVisitStatus(visit.status)
  const scheduling = operational && active.length < visit.requiredWorkers
  const conflicts = operational && conflicted
  const confirmation = operational && active.some((assignment) => (!employeeId || assignment.user.id === employeeId) && assignment.status !== 'acknowledged')
  return { scheduling, conflicts, confirmation, any: scheduling || conflicts || confirmation,
    tone: conflicts ? 'conflicts' : scheduling ? 'scheduling' : confirmation ? 'confirmation' : 'none' }
}
