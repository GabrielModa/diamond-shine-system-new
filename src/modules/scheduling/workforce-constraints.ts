import { localDateTimeToUtc, zonedParts } from './recurrence'

export type StudyRule = { dayOfWeek: number; startsMinute: number; endsMinute: number }
export type RecurringUnavailableRule = StudyRule & { reason?: string | null }
export type WorkforceLeaveRule = { kind: 'school_holiday' | 'personal_leave'; startsAt: Date; endsAt: Date; reason?: string | null }
export type WorkforceConstraintProfile = {
  studySchedules: StudyRule[]
  recurringUnavailability?: RecurringUnavailableRule[]
  leaves: WorkforceLeaveRule[]
}

export type WorkforceConstraint = {
  kind: 'personal_leave' | 'recurring_unavailability' | 'school'
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

function recurringWindow(day: Date, rule: StudyRule, timezone: string) {
  const startMinute = rule.startsMinute
  const endMinute = rule.endsMinute
  const start = localDateTimeToUtc({
    year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(),
    hour: Math.floor(startMinute / 60), minute: startMinute % 60, second: 0,
  }, timezone)
  const endDay = new Date(day)
  if (endMinute === 1440) endDay.setUTCDate(endDay.getUTCDate() + 1)
  const normalizedEnd = endMinute % 1440
  const end = localDateTimeToUtc({
    year: endDay.getUTCFullYear(), month: endDay.getUTCMonth() + 1, day: endDay.getUTCDate(),
    hour: Math.floor(normalizedEnd / 60), minute: normalizedEnd % 60, second: 0,
  }, timezone)
  return { start, end }
}

function dayMatches(day: Date, rule: StudyRule) {
  const jsDay = day.getUTCDay()
  return rule.dayOfWeek === jsDay || (jsDay === 0 && rule.dayOfWeek === 7)
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
    for (const recurring of (profile.recurringUnavailability ?? []).filter((rule) => dayMatches(day, rule))) {
      const window = recurringWindow(day, recurring, timezone)
      if (!overlaps(start, end, window.start, window.end)) continue
      return {
        kind: 'recurring_unavailability',
        startsAt: window.start,
        endsAt: window.end,
        reason: recurring.reason?.trim() || 'Recurring weekly unavailability',
      }
    }

    for (const study of profile.studySchedules.filter((rule) => dayMatches(day, rule))) {
      const window = recurringWindow(day, study, timezone)
      if (!overlaps(start, end, window.start, window.end)) continue
      const onSchoolHoliday = profile.leaves.some((leave) =>
        leave.kind === 'school_holiday' && overlaps(window.start, window.end, leave.startsAt, leave.endsAt))
      if (onSchoolHoliday) continue
      return { kind: 'school', startsAt: window.start, endsAt: window.end, reason: 'School / study schedule' }
    }
  }
  return null
}
