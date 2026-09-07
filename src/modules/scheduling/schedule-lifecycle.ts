export const BOOKED_VISIT_STATUSES = ['scheduled', 'dispatched'] as const
export const CONFIRMED_VISIT_STATUSES = ['acknowledged', 'in_progress', 'completion_blocked'] as const
export const COUNTED_VISIT_TIME_STATUSES = ['completed', 'needs_review', 'approved'] as const

export type ScheduleLifecycleState = 'booked' | 'confirmed' | 'in_progress' | 'completion_blocked' | 'done' | 'cancelled' | 'missed'

export function scheduleLifecycleState(status: string): ScheduleLifecycleState {
  if ((BOOKED_VISIT_STATUSES as readonly string[]).includes(status)) return 'booked'
  if (status === 'acknowledged') return 'confirmed'
  if (status === 'in_progress') return 'in_progress'
  if (status === 'completion_blocked') return 'completion_blocked'
  if (status === 'completed') return 'done'
  if (status === 'cancelled') return 'cancelled'
  return 'missed'
}
