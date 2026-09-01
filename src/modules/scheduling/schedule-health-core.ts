export const SCHEDULE_HEALTH_STATES = [
  'covered',
  'needs_staff',
  'unassigned',
  'expected_not_scheduled',
  'unscheduled_service',
  'service_paused',
  'cleaner_overlap',
  'acknowledgement_pending',
] as const

export type ScheduleHealthState = (typeof SCHEDULE_HEALTH_STATES)[number]

export type ScheduleConflictContext = {
  workerId: string
  workerName: string
  otherVisitId: string
  otherClientName: string
  otherSiteName: string
  otherJobName: string
  otherScheduledStart: string
  otherScheduledEnd: string
  otherTimezone: string
  overlapMinutes: number
}

export type ScheduleHealthItem = {
  id: string
  state: ScheduleHealthState
  scheduledStart?: string | null
  scheduledEnd?: string | null
  timezone?: string | null
  clientId?: string | null
  clientName: string
  siteId?: string | null
  siteName?: string | null
  servicePlanId?: string | null
  servicePlanName?: string | null
  jobId?: string | null
  jobName?: string | null
  visitId?: string | null
  pauseId?: string | null
  pauseVersion?: number | null
  requiredWorkers?: number | null
  activeWorkers?: number | null
  workerNames?: string[]
  conflict?: ScheduleConflictContext | null
  detail: string
}

export type ScheduleHealthSummary = {
  visits: number
  covered: number
  needsStaff: number
  unassigned: number
  missingSchedule: number
  unscheduledServices: number
  paused: number
  conflicts: number
  unacknowledged: number
  attention: number
}

export function coverageState(activeWorkers: number, requiredWorkers: number): 'covered' | 'needs_staff' | 'unassigned' {
  if (activeWorkers <= 0) return 'unassigned'
  if (activeWorkers < requiredWorkers) return 'needs_staff'
  return 'covered'
}

export function scheduleHealthSeverity(state: ScheduleHealthState) {
  if (state === 'cleaner_overlap' || state === 'expected_not_scheduled') return 0
  if (state === 'unassigned' || state === 'unscheduled_service') return 1
  if (state === 'needs_staff' || state === 'acknowledgement_pending') return 2
  if (state === 'service_paused') return 3
  return 4
}

export function sortScheduleHealthItems(left: ScheduleHealthItem, right: ScheduleHealthItem) {
  const severity = scheduleHealthSeverity(left.state) - scheduleHealthSeverity(right.state)
  if (severity) return severity
  const leftTime = left.scheduledStart ? new Date(left.scheduledStart).getTime() : Number.MAX_SAFE_INTEGER
  const rightTime = right.scheduledStart ? new Date(right.scheduledStart).getTime() : Number.MAX_SAFE_INTEGER
  if (leftTime !== rightTime) return leftTime - rightTime
  return `${left.clientName}:${left.siteName ?? ''}:${left.jobName ?? ''}`.localeCompare(`${right.clientName}:${right.siteName ?? ''}:${right.jobName ?? ''}`)
}

export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}
