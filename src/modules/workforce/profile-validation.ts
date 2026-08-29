export type WeeklyWindow = {
  dayOfWeek: number
  startsMinute: number
  endsMinute: number
}

export function normalizePhoneNumber(value: string) {
  let compact = value.trim().replace(/[\s().-]/g, '')
  if (compact.startsWith('00')) compact = `+${compact.slice(2)}`
  if (/^0\d{8,10}$/.test(compact)) compact = `+353${compact.slice(1)}`
  return compact
}

export function isValidPhoneNumber(value: string) {
  return /^\+[1-9]\d{7,14}$/.test(normalizePhoneNumber(value))
}

export function weeklyWindowError(windows: WeeklyWindow[], label: string) {
  for (const window of windows) {
    if (!Number.isInteger(window.dayOfWeek) || window.dayOfWeek < 1 || window.dayOfWeek > 7) {
      return `${label}: choose a valid day.`
    }
    if (!Number.isInteger(window.startsMinute) || !Number.isInteger(window.endsMinute) ||
        window.startsMinute < 0 || window.startsMinute > 1439 || window.endsMinute < 1 || window.endsMinute > 1440) {
      return `${label}: choose valid times.`
    }
    if (window.endsMinute <= window.startsMinute) {
      return `${label}: Until must be later than From.`
    }
  }

  const byDay = new Map<number, WeeklyWindow[]>()
  for (const window of windows) {
    const list = byDay.get(window.dayOfWeek) ?? []
    list.push(window)
    byDay.set(window.dayOfWeek, list)
  }
  for (const [day, list] of byDay) {
    const ordered = [...list].sort((a, b) => a.startsMinute - b.startsMinute || a.endsMinute - b.endsMinute)
    for (let i = 1; i < ordered.length; i += 1) {
      if (ordered[i].startsMinute < ordered[i - 1].endsMinute) {
        return `${label}: overlapping times are not allowed on day ${day}.`
      }
    }
  }
  return null
}
