export type OriginPoint = {
  kind: 'home' | 'school'
  label: string
  address: string
  latitude: number | null
  longitude: number | null
}

export type StudyRule = { dayOfWeek: number; startsMinute: number; endsMinute: number }
export type LeaveWindow = {
  kind: 'school_holiday' | 'personal_leave'
  startsAt: Date | string
  endsAt: Date | string
  reason?: string | null
}
export type PlanningContext = {
  timezone: string
  home: OriginPoint
  school?: OriginPoint | null
  studySchedule: StudyRule[]
  leaves: LeaveWindow[]
}

function localParts(at: Date, timezone: string) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(at)
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
  const [hour, minute] = time.split(':').map(Number)
  return { dayOfWeek: map[weekday], minuteOfDay: hour * 60 + minute }
}

function activeLeave(leaves: LeaveWindow[], kind: LeaveWindow['kind'], at: Date) {
  return leaves.find((leave) => leave.kind === kind && new Date(leave.startsAt) <= at && at < new Date(leave.endsAt)) ?? null
}

export function resolveWorkforceContext(context: PlanningContext, at = new Date()) {
  const personalLeave = activeLeave(context.leaves, 'personal_leave', at)
  const schoolHoliday = activeLeave(context.leaves, 'school_holiday', at)
  if (personalLeave) {
    return {
      state: 'personal_leave' as const,
      availableForScheduling: false,
      origin: null,
      personalLeave,
      schoolHolidayActive: Boolean(schoolHoliday),
      activeStudyRule: null,
    }
  }

  const local = localParts(at, context.timezone)
  const activeStudyRule = context.studySchedule.find((rule) =>
    rule.dayOfWeek === local.dayOfWeek &&
    local.minuteOfDay >= rule.startsMinute &&
    local.minuteOfDay < rule.endsMinute
  ) ?? null

  if (context.school && activeStudyRule && !schoolHoliday) {
    return {
      state: 'school' as const,
      availableForScheduling: true,
      origin: context.school,
      personalLeave: null,
      schoolHolidayActive: false,
      activeStudyRule,
    }
  }

  return {
    state: 'home' as const,
    availableForScheduling: true,
    origin: context.home,
    personalLeave: null,
    schoolHolidayActive: Boolean(schoolHoliday),
    activeStudyRule,
  }
}

export function remainingCapacityMinutes(target: number, planned: number) {
  return Math.max(0, target - planned)
}

export function capacityBand(plannedMinutes: number) {
  const hours = plannedMinutes / 60
  if (hours < 10) return '0-10'
  if (hours < 20) return '10-20'
  if (hours < 25) return '20-25'
  if (hours < 30) return '25-30'
  return '30+'
}
