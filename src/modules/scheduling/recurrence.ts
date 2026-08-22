type Rule =
  | { frequency: 'once' }
  | { frequency: 'daily'; interval: number }
  | { frequency: 'weekly'; interval: number; weekdays: number[] }

export function generateOccurrences(input: { startAt: Date; until: Date; recurrence: Rule; limit?: number }) {
  const limit = input.limit ?? 240
  const starts: Date[] = []
  if (input.recurrence.frequency === 'once') return input.startAt <= input.until ? [input.startAt] : []

  if (input.recurrence.frequency === 'daily') {
    const cursor = new Date(input.startAt)
    while (cursor <= input.until && starts.length < limit) {
      starts.push(new Date(cursor))
      cursor.setUTCDate(cursor.getUTCDate() + input.recurrence.interval)
    }
    return starts
  }

  const weekdays = new Set(input.recurrence.weekdays)
  const cursor = new Date(input.startAt)
  const anchor = new Date(input.startAt)
  anchor.setUTCHours(0, 0, 0, 0)
  while (cursor <= input.until && starts.length < limit) {
    const day = new Date(cursor)
    day.setUTCHours(0, 0, 0, 0)
    const elapsedDays = Math.floor((day.getTime() - anchor.getTime()) / 86_400_000)
    const elapsedWeeks = Math.floor(elapsedDays / 7)
    if (elapsedWeeks % input.recurrence.interval === 0 && weekdays.has(cursor.getUTCDay())) starts.push(new Date(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return starts
}

export function generationKey(date: Date) {
  return date.toISOString()
}
