export type AvailabilityNoticeLevel = 'planned' | 'late' | 'urgent'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export function classifyAvailabilityNotice(startsAt: Date, now = new Date()): AvailabilityNoticeLevel {
  const leadMs = startsAt.getTime() - now.getTime()
  if (leadMs < DAY_MS) return 'urgent'
  if (leadMs < 7 * DAY_MS) return 'late'
  return 'planned'
}

export function workforceProfileReady(profile: { weeklyTargetConfigured: boolean } | null | undefined) {
  return Boolean(profile?.weeklyTargetConfigured)
}
