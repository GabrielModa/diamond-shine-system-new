import { localDateTimeToUtc, zonedParts } from '../modules/scheduling/recurrence'

export const WORKFORCE_RANGE_DAYS = { week: 7, fortnight: 14, month: 30, quarter: 90 } as const
export type WorkforceRange = keyof typeof WORKFORCE_RANGE_DAYS
export type WorkforcePeriodParams = { range?: WorkforceRange; from?: string; to?: string }

function calendarDateFromIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  const valueDate = new Date(Date.UTC(year, month - 1, day))
  if (valueDate.getUTCFullYear() !== year || valueDate.getUTCMonth() + 1 !== month || valueDate.getUTCDate() !== day) return null
  return valueDate
}
function isoCalendar(date: Date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}` }
function localDayBoundary(value: string, timezone: string, endExclusive = false) {
  const calendar = calendarDateFromIso(value)
  if (!calendar) return null
  if (endExclusive) calendar.setUTCDate(calendar.getUTCDate() + 1)
  return localDateTimeToUtc({ year: calendar.getUTCFullYear(), month: calendar.getUTCMonth()+1, day: calendar.getUTCDate(), hour: 0, minute: 0, second: 0 }, timezone)
}
export function workforceWeekdayCount(from: Date, toExclusive: Date, timezone: string) {
  const first = zonedParts(from, timezone)
  const last = zonedParts(new Date(Math.max(from.getTime(), toExclusive.getTime() - 1)), timezone)
  const cursor = new Date(Date.UTC(first.year, first.month - 1, first.day))
  const end = new Date(Date.UTC(last.year, last.month - 1, last.day))
  let count = 0
  while (cursor <= end) { if (![0,6].includes(cursor.getUTCDay())) count += 1; cursor.setUTCDate(cursor.getUTCDate()+1) }
  return Math.max(1, count)
}
export function resolveWorkforcePeriod(params: WorkforcePeriodParams, now: Date, timezone: string) {
  if (params.from || params.to) {
    if (!params.from || !params.to) return null
    const fromCalendar = calendarDateFromIso(params.from), toCalendar = calendarDateFromIso(params.to)
    if (!fromCalendar || !toCalendar || toCalendar < fromCalendar) return null
    const from = localDayBoundary(params.from, timezone)!, toExclusive = localDayBoundary(params.to, timezone, true)!
    return { from, toExclusive, to: new Date(toExclusive.getTime()-1), label: 'custom' as const, weekdays: workforceWeekdayCount(from, toExclusive, timezone) }
  }
  const range = params.range ?? 'week'
  const days = WORKFORCE_RANGE_DAYS[range]
  const local = zonedParts(now, timezone)
  const endCalendar = new Date(Date.UTC(local.year, local.month - 1, local.day))
  const startCalendar = new Date(endCalendar); startCalendar.setUTCDate(startCalendar.getUTCDate() - (days - 1))
  const from = localDayBoundary(isoCalendar(startCalendar), timezone)!, toExclusive = localDayBoundary(isoCalendar(endCalendar), timezone, true)!
  return { from, toExclusive, to: new Date(toExclusive.getTime()-1), label: range, weekdays: workforceWeekdayCount(from, toExclusive, timezone) }
}
