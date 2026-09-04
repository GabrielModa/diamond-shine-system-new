export type WorkforceLiveState = 'on_job' | 'starting_soon' | 'attention' | 'expected_school' | 'available' | 'unavailable'
export type WorkforceSignalState = 'fresh' | 'stale' | 'missing' | 'not_expected'

export type LiveVisitWindow = {
  id: string
  scheduledStart: Date
  scheduledEnd: Date
}

export type LiveStatusInput = {
  now: Date
  setupRequired?: boolean
  contextState: 'home' | 'school' | 'personal_leave' | 'recurring_unavailability' | 'temporary_unavailability'
  runningEntry?: {
    startedAt: Date
    lastSignalAt: Date | null
    locationClassification: string | null
    hasCriticalIncident?: boolean
    terminalVisitStatus?: string | null
  } | null
  currentVisit?: LiveVisitWindow | null
  nextVisit?: LiveVisitWindow | null
}

const MINUTE = 60_000
export const LIVE_SIGNAL_FRESH_MS = 5 * MINUTE
export const LIVE_SIGNAL_ATTENTION_MS = 10 * MINUTE
export const LIVE_STARTING_SOON_MS = 30 * MINUTE
export const LIVE_CLOCK_IN_GRACE_MS = 10 * MINUTE

function signalState(input: LiveStatusInput) {
  if (!input.runningEntry) return 'not_expected' as const
  if (!input.runningEntry.lastSignalAt) return 'missing' as const
  const age = Math.max(0, input.now.getTime() - input.runningEntry.lastSignalAt.getTime())
  return age <= LIVE_SIGNAL_FRESH_MS ? 'fresh' as const : 'stale' as const
}

export function resolveWorkforceLiveStatus(input: LiveStatusInput) {
  const signal = signalState(input)

  if (input.runningEntry) {
    const signalAgeMs = input.runningEntry.lastSignalAt
      ? Math.max(0, input.now.getTime() - input.runningEntry.lastSignalAt.getTime())
      : null
    const locationProblem = ['suspicious', 'unavailable'].includes(input.runningEntry.locationClassification ?? '')
    const terminalVisit = Boolean(input.runningEntry.terminalVisitStatus)
    const attention = terminalVisit || signalAgeMs == null || signalAgeMs > LIVE_SIGNAL_ATTENTION_MS || locationProblem || Boolean(input.runningEntry.hasCriticalIncident)
    const reason = input.runningEntry.hasCriticalIncident
      ? 'Critical incident on the active visit.'
      : terminalVisit
        ? `Timer is still running although the visit is ${input.runningEntry.terminalVisitStatus}.`
        : locationProblem
          ? 'Latest work-location check needs review.'
          : signalAgeMs == null
            ? 'No work-location signal has been received for this active timer.'
            : signalAgeMs > LIVE_SIGNAL_ATTENTION_MS
              ? 'Work-location signal is stale for this active timer.'
              : null
    return { state: 'on_job' as const, signalState: signal, attention, attentionReason: reason }
  }

  if (input.currentVisit) {
    const minutesSinceStart = Math.floor((input.now.getTime() - input.currentVisit.scheduledStart.getTime()) / MINUTE)
    if (input.now.getTime() - input.currentVisit.scheduledStart.getTime() >= LIVE_CLOCK_IN_GRACE_MS) {
      return {
        state: 'attention' as const,
        signalState: 'missing' as const,
        attention: true,
        attentionReason: `Visit started ${Math.max(0, minutesSinceStart)} min ago with no active clock-in.`,
      }
    }
    return { state: 'starting_soon' as const, signalState: 'not_expected' as const, attention: false, attentionReason: null }
  }

  if (input.nextVisit) {
    const untilStart = input.nextVisit.scheduledStart.getTime() - input.now.getTime()
    if (untilStart >= 0 && untilStart <= LIVE_STARTING_SOON_MS) {
      return { state: 'starting_soon' as const, signalState: 'not_expected' as const, attention: false, attentionReason: null }
    }
  }

  if (input.contextState === 'school') {
    return { state: 'expected_school' as const, signalState: 'not_expected' as const, attention: false, attentionReason: null }
  }

  if (input.setupRequired) {
    return { state: 'unavailable' as const, signalState: 'not_expected' as const, attention: false, attentionReason: 'Workforce setup is required before scheduling.' }
  }

  if (['personal_leave', 'recurring_unavailability', 'temporary_unavailability'].includes(input.contextState)) {
    return { state: 'unavailable' as const, signalState: 'not_expected' as const, attention: false, attentionReason: null }
  }

  return { state: 'available' as const, signalState: 'not_expected' as const, attention: false, attentionReason: null }
}
