export type StudyRule = { dayOfWeek: number; startsMinute: number; endsMinute: number }

const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function minutesToClock(minutes: number) {
  const safe = Math.max(0, Math.min(1440, minutes))
  if (safe === 1440) return '24:00'
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

export function schoolScheduleSummary(rules: StudyRule[]) {
  if (!rules.length) return 'No school schedule'
  const groups = new Map<string, number[]>()
  for (const rule of rules) {
    const time = `${minutesToClock(rule.startsMinute)}–${minutesToClock(rule.endsMinute)}`
    groups.set(time, [...(groups.get(time) ?? []), rule.dayOfWeek])
  }
  return Array.from(groups.entries())
    .map(([time, days]) => `${days.map((day) => dayNames[day]).join(', ')} · ${time}`)
    .join(' · ')
}

export function currentSchoolWindow(
  rules: StudyRule[],
  now: Date,
  timezone = 'Europe/Dublin',
) {
  const weekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now)
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekdayShort)
  const dayOfWeek = weekday === 0 ? 7 : weekday
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0')
  const nowMinute = hour * 60 + minute
  const today = rules.filter((rule) => rule.dayOfWeek === dayOfWeek)
  const active = today.find((rule) => nowMinute >= rule.startsMinute && nowMinute < rule.endsMinute) ?? null
  const next = today.find((rule) => rule.startsMinute > nowMinute) ?? null
  return { active, next }
}
