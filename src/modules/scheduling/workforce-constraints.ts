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

function clipWindow(start: Date, end: Date, from: Date, to: Date) {
  const clippedStart = new Date(Math.max(start.getTime(), from.getTime()))
  const clippedEnd = new Date(Math.min(end.getTime(), to.getTime()))
  return clippedEnd > clippedStart ? { start: clippedStart, end: clippedEnd } : null
}

function subtractWindow(
  segments: Array<{ start: Date; end: Date }>,
  blockedStart: Date,
  blockedEnd: Date,
) {
  return segments.flatMap((segment) => {
    if (!overlaps(segment.start, segment.end, blockedStart, blockedEnd)) return [segment]
    const result: Array<{ start: Date; end: Date }> = []
    if (blockedStart > segment.start) result.push({ start: segment.start, end: new Date(Math.min(blockedStart.getTime(), segment.end.getTime())) })
    if (blockedEnd < segment.end) result.push({ start: new Date(Math.max(blockedEnd.getTime(), segment.start.getTime())), end: segment.end })
    return result.filter((item) => item.end > item.start)
  })
}

function schoolOverlapCoveredByHoliday(
  visitStart: Date,
  visitEnd: Date,
  schoolStart: Date,
  schoolEnd: Date,
  leaves: WorkforceLeaveRule[],
) {
  const overlapStart = new Date(Math.max(visitStart.getTime(), schoolStart.getTime()))
  const overlapEnd = new Date(Math.min(visitEnd.getTime(), schoolEnd.getTime()))
  if (overlapEnd <= overlapStart) return false
  return leaves.some((leave) =>
    leave.kind === 'school_holiday'
    && leave.startsAt <= overlapStart
    && leave.endsAt >= overlapEnd)
}

/**
 * Expands the same workforce rules used by visit validation into concrete
 * unavailable windows. Schedule clients can consume these windows without
 * reimplementing school / leave / recurring-rule logic in React.
 */
export function workforceConstraintWindows(
  profile: WorkforceConstraintProfile | null | undefined,
  from: Date,
  to: Date,
  timezone: string,
): WorkforceConstraint[] {
  if (!profile || to <= from) return []
  const windows: WorkforceConstraint[] = []

  for (const leave of profile.leaves) {
    if (leave.kind !== 'personal_leave') continue
    const clipped = clipWindow(leave.startsAt, leave.endsAt, from, to)
    if (!clipped) continue
    windows.push({
      kind: 'personal_leave',
      startsAt: clipped.start,
      endsAt: clipped.end,
      reason: leave.reason?.trim() || 'Personal leave',
    })
  }

  const schoolHolidays = profile.leaves.filter((leave) => leave.kind === 'school_holiday')
  for (const day of localCalendarDays(from, to, timezone)) {
    for (const recurring of (profile.recurringUnavailability ?? []).filter((rule) => dayMatches(day, rule))) {
      const window = recurringWindow(day, recurring, timezone)
      const clipped = clipWindow(window.start, window.end, from, to)
      if (!clipped) continue
      windows.push({
        kind: 'recurring_unavailability',
        startsAt: clipped.start,
        endsAt: clipped.end,
        reason: recurring.reason?.trim() || 'Recurring weekly unavailability',
      })
    }

    for (const study of profile.studySchedules.filter((rule) => dayMatches(day, rule))) {
      const window = recurringWindow(day, study, timezone)
      let segments = [{ start: window.start, end: window.end }]
      for (const holiday of schoolHolidays) {
        segments = subtractWindow(segments, holiday.startsAt, holiday.endsAt)
        if (!segments.length) break
      }
      for (const segment of segments) {
        const clipped = clipWindow(segment.start, segment.end, from, to)
        if (!clipped) continue
        windows.push({
          kind: 'school',
          startsAt: clipped.start,
          endsAt: clipped.end,
          reason: 'School / study schedule',
        })
      }
    }
  }

  return windows.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
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
      if (schoolOverlapCoveredByHoliday(start, end, window.start, window.end, profile.leaves)) continue
      return { kind: 'school', startsAt: window.start, endsAt: window.end, reason: 'School / study schedule' }
    }
  }
  return null
}
