import { generateOccurrences } from '../../modules/scheduling/recurrence'

type JobLike = {
  startDate: string
  recurrence: unknown
}

type RecurrenceRule =
  | { frequency: 'once' }
  | { frequency: 'daily'; interval: number }
  | { frequency: 'weekly'; interval: number; weekdays: number[] }

function recurrenceRule(value: unknown): RecurrenceRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { frequency: 'weekly', interval: 1, weekdays: [1] }
  const rule = value as { frequency?: unknown; interval?: unknown; weekdays?: unknown }
  if (rule.frequency === 'once') return { frequency: 'once' }
  if (rule.frequency === 'daily') return { frequency: 'daily', interval: typeof rule.interval === 'number' && rule.interval > 0 ? Math.floor(rule.interval) : 1 }
  if (rule.frequency === 'weekly') {
    const weekdays = Array.isArray(rule.weekdays)
      ? rule.weekdays.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)
      : []
    return {
      frequency: 'weekly',
      interval: typeof rule.interval === 'number' && rule.interval > 0 ? Math.floor(rule.interval) : 1,
      weekdays: weekdays.length ? weekdays : [1],
    }
  }
  return { frequency: 'weekly', interval: 1, weekdays: [1] }
}

export function calendarDateInZone(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function nextServiceChangeDate(job: JobLike | undefined, timezone: string, now = new Date()) {
  const fallback = new Date(now.getTime() + 86_400_000)
  if (!job) return calendarDateInZone(fallback, timezone)

  const startAt = new Date(job.startDate)
  if (Number.isNaN(startAt.getTime())) return calendarDateInZone(fallback, timezone)

  const until = new Date(now.getTime() + 366 * 86_400_000)
  const [nextOccurrence] = generateOccurrences({
    startAt,
    until,
    recurrence: recurrenceRule(job.recurrence),
    timezone,
    from: now,
    limit: 1,
  })
  return calendarDateInZone(nextOccurrence ?? fallback, timezone)
}
