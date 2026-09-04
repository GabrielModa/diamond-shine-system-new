import { calendarDateKey, operationalCalendarDate } from '../../lib/operational-time'

export type ScheduleView = 'month' | 'week' | 'day' | 'list'

export function readScheduleContext(params: URLSearchParams, timezone: string, fallbackDate: Date) {
  const rawDate = params.get('date')
  let date = fallbackDate
  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    const [year, month, day] = rawDate.split('-').map(Number)
    const candidate = new Date(year, month - 1, day, 12)
    if (calendarDateKey(candidate) === rawDate) date = candidate
  } else if (rawDate && !Number.isNaN(new Date(rawDate).getTime())) {
    date = operationalCalendarDate(new Date(rawDate), timezone)
  }
  const view = params.get('view')
  return {
    date,
    view: (['week', 'day', 'month', 'list'].includes(view ?? '') ? view : 'week') as ScheduleView,
    team: params.get('team') === 'unassigned' ? 'unassigned' : params.get('employee') || 'all',
  }
}

export function writeScheduleContext(params: URLSearchParams, update: { date?: Date; view?: ScheduleView; team?: string }) {
  const next = new URLSearchParams(params)
  if (update.date) next.set('date', calendarDateKey(update.date))
  if (update.view) next.set('view', update.view)
  if (update.team) {
    next.delete('employee'); next.delete('team')
    if (update.team === 'unassigned') next.set('team', 'unassigned')
    else if (update.team !== 'all') next.set('employee', update.team)
  }
  return next
}
