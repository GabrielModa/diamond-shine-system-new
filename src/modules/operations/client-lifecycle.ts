import { effectivePauseEnd, type PauseWindow } from '../scheduling/service-pause'

export function isManualExtraRecurrence(value: unknown) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as { source?: unknown }).source === 'manual_extra'
}

type LifecycleClient = {
  archivedAt: Date | null
  sites: Array<{ servicePlans: Array<{ status: string; jobs: Array<{
    status: string; endDate: Date | null; recurrence: unknown
  }> }> }>
}

export function clientLifecycle(client: LifecycleClient, pauses: PauseWindow[], now = new Date()) {
  const plans = client.sites.flatMap(site => site.servicePlans)
  const current = plans.filter(plan => plan.status === 'published' && plan.jobs.some(job =>
    !isManualExtraRecurrence(job.recurrence) && ['active', 'paused'].includes(job.status)
    && (!job.endDate || job.endDate > now)))
  const accountPause = pauses.find(pause => pause.scope === 'client'
    && pause.startsAt <= now && effectivePauseEnd(pause) > now)
  const historical = plans.some(plan => plan.jobs.some(job => !isManualExtraRecurrence(job.recurrence)))
  return {
    serviceCount: plans.length,
    activeServiceCount: current.length,
    lifecycle: client.archivedAt ? 'archived' : current.length ? accountPause ? 'paused' : 'in_service'
      : historical ? 'ended' : 'setup_needed',
    accountPause: accountPause ?? null,
  }
}