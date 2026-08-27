import { intervalsOverlap } from './schedule-health-core'

export type PauseWindow = {
  id: string
  scope: 'client' | 'site' | 'job'
  clientId: string | null
  siteId: string | null
  jobId: string | null
  startsAt: Date
  endsAt: Date
  endedEarlyAt: Date | null
  version?: number
}

export function effectivePauseEnd(pause: PauseWindow) {
  return pause.endedEarlyAt && pause.endedEarlyAt < pause.endsAt ? pause.endedEarlyAt : pause.endsAt
}

export function pauseAppliesTo(
  pause: PauseWindow,
  target: { clientId: string; siteId: string; jobId: string },
  start: Date,
  end: Date,
) {
  const targetMatches = pause.scope === 'client'
    ? pause.clientId === target.clientId
    : pause.scope === 'site'
      ? pause.siteId === target.siteId
      : pause.jobId === target.jobId
  return targetMatches && intervalsOverlap(start, end, pause.startsAt, effectivePauseEnd(pause))
}
