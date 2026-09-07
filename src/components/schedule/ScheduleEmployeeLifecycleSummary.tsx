'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatDuration } from '../../lib/duration'
import { activeAssignments, plannedMinutes, scheduleLifecycleBucket, type ScheduleLifecycleBucket } from './schedule-lifecycle'
import './ScheduleLifecycle.css'

type SummaryVisit = {
  id: string
  status: string
  scheduledStart: string
  scheduledEnd: string
  requiredWorkers: number
  assignments: Array<{ status: string; user: { id: string } }>
}

type TimeEntry = {
  kind: string
  status: string
  startedAt: string
  endedAt: string | null
  durationSeconds: number | null
  visit: { id: string; status: string } | null
}

function workedSeconds(entry: TimeEntry) {
  if (entry.status === 'rejected') return 0
  if (entry.durationSeconds != null) return Math.max(0, entry.durationSeconds)
  if (!entry.endedAt) return 0
  return Math.max(0, Math.round((new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / 1000))
}

export default function ScheduleEmployeeLifecycleSummary({
  employeeId,
  employeeName,
  visits,
  from,
  to,
  activeFilter,
  canReviewTime,
  onFilter,
}: {
  employeeId: string
  employeeName: string
  visits: SummaryVisit[]
  from: string
  to: string
  activeFilter: string
  canReviewTime: boolean
  onFilter: (filter: ScheduleLifecycleBucket) => void
}) {
  const [entries, setEntries] = useState<TimeEntry[] | null>(null)

  useEffect(() => {
    if (!canReviewTime) { setEntries(null); return }
    const controller = new AbortController()
    const query = new URLSearchParams({ userId: employeeId, from, to })
    void fetch(`/api/time-entries?${query}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok || !body?.ok) throw new Error('Could not load worked time')
        if (!controller.signal.aborted) setEntries(body.data as TimeEntry[])
      })
      .catch(() => { if (!controller.signal.aborted) setEntries(null) })
    return () => controller.abort()
  }, [canReviewTime, employeeId, from, to])

  const metrics = useMemo(() => {
    const assigned = visits.filter((visit) => activeAssignments(visit).some((assignment) => assignment.user.id === employeeId))
    const byBucket = (bucket: ScheduleLifecycleBucket) => assigned.filter((visit) => scheduleLifecycleBucket(visit, employeeId) === bucket)
    const booked = byBucket('booked')
    const confirmed = byBucket('confirmed')
    const done = byBucket('done')
    const doneIds = new Set(done.map((visit) => visit.id))
    const doneWorkedSeconds = (entries ?? [])
      .filter((entry) => entry.kind === 'visit' && entry.visit && doneIds.has(entry.visit.id))
      .reduce((total, entry) => total + workedSeconds(entry), 0)
    return {
      booked: { count: booked.length, minutes: booked.reduce((total, visit) => total + plannedMinutes(visit), 0) },
      confirmed: { count: confirmed.length, minutes: confirmed.reduce((total, visit) => total + plannedMinutes(visit), 0), inProgress: confirmed.filter((visit) => visit.status === 'in_progress').length },
      done: { count: done.length, plannedMinutes: done.reduce((total, visit) => total + plannedMinutes(visit), 0), workedSeconds: doneWorkedSeconds },
    }
  }, [employeeId, entries, visits])

  return <section className="schedule-lifecycle-summary" aria-label={`${employeeName} schedule lifecycle`}>
    <header>
      <div><span className="eyebrow">Employee workload</span><strong>{employeeName}</strong></div>
      <small>Hours below follow the visible calendar period.</small>
    </header>
    <div className="schedule-lifecycle-metrics">
      <button type="button" data-kind="booked" data-active={activeFilter === 'booked'} onClick={() => onFilter('booked')}>
        <span>Booked</span><strong>{metrics.booked.count}</strong><small>{formatDuration(metrics.booked.minutes)} planned</small>
      </button>
      <button type="button" data-kind="confirmed" data-active={activeFilter === 'confirmed'} onClick={() => onFilter('confirmed')}>
        <span>Confirmed</span><strong>{metrics.confirmed.count}</strong><small>{formatDuration(metrics.confirmed.minutes)} planned</small>
        {metrics.confirmed.inProgress ? <em>● {metrics.confirmed.inProgress} working now</em> : null}
      </button>
      <button type="button" data-kind="done" data-active={activeFilter === 'done'} onClick={() => onFilter('done')}>
        <span>Done</span><strong>{metrics.done.count}</strong><small>{entries ? `${formatDuration(Math.round(metrics.done.workedSeconds / 60))} worked` : `${formatDuration(metrics.done.plannedMinutes)} planned`}</small>
      </button>
    </div>
  </section>
}
