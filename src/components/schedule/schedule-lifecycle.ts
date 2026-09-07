export type ScheduleLifecycleBucket = 'booked' | 'confirmed' | 'done' | 'history'

type AssignmentLike = { status: string; user: { id: string } }
type VisitLike = {
  status: string
  scheduledStart: string
  scheduledEnd: string
  requiredWorkers: number
  assignments: AssignmentLike[]
}

const ACTIVE_ASSIGNMENT_STATUSES = new Set(['assigned', 'notified', 'seen', 'acknowledged'])
const CONFIRMED_VISIT_STATUSES = new Set(['acknowledged', 'in_progress', 'completion_blocked'])

export function activeAssignments(visit: VisitLike) {
  return visit.assignments.filter((assignment) => ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status))
}

export function scheduleLifecycleBucket(visit: VisitLike, employeeId?: string | null): ScheduleLifecycleBucket {
  if (visit.status === 'completed') return 'done'
  if (visit.status === 'cancelled' || visit.status === 'missed') return 'history'
  if (visit.status === 'in_progress' || visit.status === 'completion_blocked') return 'confirmed'

  const active = activeAssignments(visit)
  if (employeeId) {
    const assignment = active.find((item) => item.user.id === employeeId)
    return assignment?.status === 'acknowledged' ? 'confirmed' : 'booked'
  }

  const fullyCovered = active.length >= visit.requiredWorkers
  const allAcknowledged = active.length > 0 && active.every((assignment) => assignment.status === 'acknowledged')
  return CONFIRMED_VISIT_STATUSES.has(visit.status) || (fullyCovered && allAcknowledged) ? 'confirmed' : 'booked'
}

export function plannedMinutes(visit: Pick<VisitLike, 'scheduledStart' | 'scheduledEnd'>) {
  return Math.max(0, Math.round((new Date(visit.scheduledEnd).getTime() - new Date(visit.scheduledStart).getTime()) / 60_000))
}

export function lifecycleLabel(status: string) {
  if (status === 'in_progress') return 'Working now'
  if (status === 'completion_blocked') return 'Finish blocked'
  if (status === 'completed') return 'Done'
  if (status === 'acknowledged') return 'Confirmed'
  if (status === 'dispatched' || status === 'scheduled') return 'Booked'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'missed') return 'Missed'
  return status.replaceAll('_', ' ')
}
