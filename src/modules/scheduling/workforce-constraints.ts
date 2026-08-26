import { localDateTimeToUtc, zonedParts } from './recurrence'

export type StudyRule = { dayOfWeek: number; startsMinute: number; endsMinute: number }
export type WorkforceLeaveRule = { kind: 'school_holiday' | 'personal_leave'; startsAt: Date; endsAt: Date; reason?: string | null }
export type WorkforceConstraintProfile = {
  studySchedules: StudyRule[]
  leaves: WorkforceLeaveRule[]
}

export type WorkforceConstraint = {
  kind: 'personal_leave' | 'school'
  startsAt: Date
  endsAt: Date
  reason: string
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

function localCalendarDays(start: Date, end: Date, timezone: string) {
  const startParts = zonedParts(start, timezone)
  const endParts = zonedParts(new Date(Math.max(start.getTime(), end.getTime() - 1)), timezone)
  const first = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day))
  const last = new Date(Date.UTC(endParts.year, endParts.month - 1, endParts.day))
  const days: Date[] = []
  for (const cursor = new Date(first); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) days.push(new Date(cursor))
  return days
}

function schoolWindow(day: Date, rule: StudyRule, timezone: string) {
  const startsDayOffset = Math.floor(rule.startsMinute / 1440)
  const endsDayOffset = Math.floor(rule.endsMinute / 1440)
  const startMinute = rule.startsMinute % 1440
  let endMinute = rule.endsMinute % 1440
  let effectiveEndOffset = endsDayOffset
  if (rule.endsMinute > rule.startsMinute && endMinute === 0) effectiveEndOffset = Math.max(1, endsDayOffset)
  if (rule.endsMinute <= rule.startsMinute) effectiveEndOffset = Math.max(1, effectiveEndOffset)

  const startDay = new Date(day); startDay.setUTCDate(startDay.getUTCDate() + startsDayOffset)
  const endDay = new Date(day); endDay.setUTCDate(endDay.getUTCDate() + effectiveEndOffset)
  const start = localDateTimeToUtc({
    year: startDay.getUTCFullYear(), month: startDay.getUTCMonth() + 1, day: startDay.getUTCDate(),
    hour: Math.floor(startMinute / 60), minute: startMinute % 60, second: 0,
  }, timezone)
  const end = localDateTimeToUtc({
    year: endDay.getUTCFullYear(), month: endDay.getUTCMonth() + 1, day: endDay.getUTCDate(),
    hour: Math.floor(endMinute / 60), minute: endMinute % 60, second: 0,
  }, timezone)
  return { start, end }
}

export function workforceConstraintForWindow(
  profile: WorkforceConstraintProfile | null | undefined,
  start: Date,
  end: Date,
  timezone: string,
): WorkforceConstraint | null {
  if (!profile || end <= start) return null

  const personalLeave = profile.leaves.find((leave) => leave.kind === 'personal_leave' && overlaps(start, end, leave.startsAt, leave.endsAt))
  if (personalLeave) {
    return {
      kind: 'personal_leave', startsAt: personalLeave.startsAt, endsAt: personalLeave.endsAt,
      reason: personalLeave.reason?.trim() || 'Personal leave',
    }
  }

  for (const day of localCalendarDays(start, end, timezone)) {
    const jsDay = day.getUTCDay()
    const rule = profile.studySchedules.find((item) => item.dayOfWeek === jsDay || (jsDay === 0 && item.dayOfWeek === 7))
    if (!rule) continue
    const window = schoolWindow(day, rule, timezone)
    if (!overlaps(start, end, window.start, window.end)) continue
    const onSchoolHoliday = profile.leaves.some((leave) =>
      leave.kind === 'school_holiday' && overlaps(window.start, window.end, leave.startsAt, leave.endsAt))
    if (onSchoolHoliday) continue
    return { kind: 'school', startsAt: window.start, endsAt: window.end, reason: 'School / study schedule' }
  }
  return null
}
