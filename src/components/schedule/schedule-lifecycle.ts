import { isActiveAssignmentStatus } from '../../modules/scheduling/assignment-lifecycle'

type AssignmentLike = { status: string; user: { id: string } }
type TimeEntryLike = { userId: string; kind: string; status: string; durationSeconds?: number | null }

type VisitLike = {
  status: string
  scheduledStart: string
  scheduledEnd: string
  assignments: AssignmentLike[]
  timeEntries?: TimeEntryLike[]
}

export type ScheduleLifecycleFilter = 'attention' | 'booked' | 'confirmed' | 'done' | 'history'
export type ScheduleLifecycleState = 'booked' | 'confirmed' | 'in_progress' | 'completion_blocked' | 'done' | 'cancelled' | 'missed'

export const BOOKED_VISIT_STATUSES = ['scheduled', 'dispatched'] as const
export const CONFIRMED_VISIT_STATUSES = ['acknowledged', 'in_progress', 'completion_blocked'] as const
export const COUNTED_VISIT_TIME_STATUSES = ['completed', 'needs_review', 'approved'] as const
const COUNTED_TIME_STATUSES = new Set<string>(COUNTED_VISIT_TIME_STATUSES)

export function scheduleLifecycleState(status: string): ScheduleLifecycleState {
  if ((BOOKED_VISIT_STATUSES as readonly string[]).includes(status)) return 'booked'
  if (status === 'acknowledged') return 'confirmed'
  if (status === 'in_progress') return 'in_progress'
  if (status === 'completion_blocked') return 'completion_blocked'
  if (status === 'completed') return 'done'
  if (status === 'cancelled') return 'cancelled'
  return 'missed'
}

export function matchesScheduleLifecycleFilter(status: string, filter: ScheduleLifecycleFilter) {
  const state = scheduleLifecycleState(status)
  if (filter === 'booked') return state === 'booked'
  if (filter === 'confirmed') return state === 'confirmed' || state === 'in_progress' || state === 'completion_blocked'
  if (filter === 'done') return state === 'done'
  if (filter === 'history') return state === 'cancelled' || state === 'missed'
  return false
}

export function scheduleLifecycleLabel(status: string) {
  const state = scheduleLifecycleState(status)
  if (state === 'booked') return 'Booked'
  if (state === 'confirmed') return 'Confirmed'
  if (state === 'in_progress') return 'In progress now'
  if (state === 'completion_blocked') return 'Completion blocked'
  if (state === 'done') return 'Done'
  if (state === 'cancelled') return 'Cancelled'
  return 'Missed'
}

function plannedMinutes(visit: VisitLike) {
  return Math.max(0, Math.round((new Date(visit.scheduledEnd).getTime() - new Date(visit.scheduledStart).getTime()) / 60_000))
}

function employeeAssigned(visit: VisitLike, employeeId: string) {
  return visit.assignments.some((assignment) => assignment.user.id === employeeId && isActiveAssignmentStatus(assignment.status))
}

function employeeActualMinutes(visit: VisitLike, employeeId: string) {
  const seconds = (visit.timeEntries ?? [])
    .filter((entry) => entry.userId === employeeId && entry.kind === 'visit' && COUNTED_TIME_STATUSES.has(entry.status) && entry.durationSeconds != null)
    .reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0)
  return Math.round(seconds / 60)
}

export function employeeScheduleHours(visits: VisitLike[], employeeId: string) {
  return visits.reduce((summary, visit) => {
    if (!employeeAssigned(visit, employeeId)) return summary
    const state = scheduleLifecycleState(visit.status)
    if (state === 'booked') summary.bookedMinutes += plannedMinutes(visit)
    else if (state === 'confirmed' || state === 'in_progress' || state === 'completion_blocked') summary.confirmedMinutes += plannedMinutes(visit)
    else if (state === 'done') summary.doneMinutes += employeeActualMinutes(visit, employeeId)
    return summary
  }, { bookedMinutes: 0, confirmedMinutes: 0, doneMinutes: 0 })
}
