type Rule =
  | { frequency: 'once' }
  | { frequency: 'daily'; interval: number }
  | { frequency: 'weekly'; interval: number; weekdays: number[] }

type LocalParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timezone: string) {
  let value = formatterCache.get(timezone)
  if (!value) {
    value = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    })
    formatterCache.set(timezone, value)
  }
  return value
}

export function zonedParts(date: Date, timezone: string): LocalParts {
  const parts = formatter(timezone).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour: get('hour'), minute: get('minute'), second: get('second'),
  }
}

/** Convert a local wall-clock datetime in an IANA timezone to a UTC instant. */
export function localDateTimeToUtc(parts: LocalParts, timezone: string) {
  const desiredAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0)
  let candidate = new Date(desiredAsUtc)
  // Two/three passes are enough for normal IANA offset changes around DST boundaries.
  for (let pass = 0; pass < 4; pass += 1) {
    const actual = zonedParts(candidate, timezone)
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second, 0)
    const delta = desiredAsUtc - actualAsUtc
    if (delta === 0) return candidate
    candidate = new Date(candidate.getTime() + delta)
  }
  return candidate
}

function calendarDate(parts: Pick<LocalParts, 'year'|'month'|'day'>) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
}

function localPartsForCalendarDay(day: Date, wall: Pick<LocalParts, 'hour'|'minute'|'second'>): LocalParts {
  return {
    year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(),
    hour: wall.hour, minute: wall.minute, second: wall.second,
  }
}

export function generateOccurrences(input: { startAt: Date; until: Date; recurrence: Rule; timezone?: string; limit?: number }) {
  const limit = input.limit ?? 240
  const timezone = input.timezone ?? 'UTC'
  if (input.recurrence.frequency === 'once') return input.startAt <= input.until ? [input.startAt] : []

  const startLocal = zonedParts(input.startAt, timezone)
  const wall = { hour: startLocal.hour, minute: startLocal.minute, second: startLocal.second }
  const anchorDay = calendarDate(startLocal)
  const starts: Date[] = []

  if (input.recurrence.frequency === 'daily') {
    for (let dayOffset = 0; starts.length < limit; dayOffset += input.recurrence.interval) {
      const day = new Date(anchorDay)
      day.setUTCDate(day.getUTCDate() + dayOffset)
      const occurrence = localDateTimeToUtc(localPartsForCalendarDay(day, wall), timezone)
      if (occurrence > input.until) break
      if (occurrence >= input.startAt) starts.push(occurrence)
    }
    return starts
  }

  const weekdays = new Set(input.recurrence.weekdays)
  // Weekly interval is measured in 7-day blocks anchored on the start date, matching legacy behaviour.
  for (let dayOffset = 0; starts.length < limit; dayOffset += 1) {
    const day = new Date(anchorDay)
    day.setUTCDate(day.getUTCDate() + dayOffset)
    const elapsedWeeks = Math.floor(dayOffset / 7)
    if (elapsedWeeks % input.recurrence.interval !== 0 || !weekdays.has(day.getUTCDay())) continue
    const occurrence = localDateTimeToUtc(localPartsForCalendarDay(day, wall), timezone)
    if (occurrence > input.until) break
    if (occurrence >= input.startAt) starts.push(occurrence)
  }
  return starts
}

export function generationKey(date: Date) {
  return date.toISOString()
}
