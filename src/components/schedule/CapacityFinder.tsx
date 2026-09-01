'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatOperationalTime, operationalDateKey, operationalInputToUtc } from '../../lib/operational-time'
import DurationField from '../ui/DurationField'
import TeamPicker, { type ScheduleTeamMember } from './TeamPicker'

type CapacityBlockKind = 'booked' | 'temporary_unavailability' | 'personal_leave' | 'recurring_unavailability' | 'school'
type CapacityWindow = {
  start: string
  end: string
  total: number
  available: number
  blockedCount: number
  blockedBy: Record<CapacityBlockKind, number>
}
type CapacityResponse = { timezone: string; windows: CapacityWindow[] }

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) throw new Error(body?.error ?? 'Request failed')
  return body.data as T
}

const HOURS = [7, 9, 11, 13, 15, 17]

function blockerSummary(window: CapacityWindow) {
  if (!window.blockedCount) return 'clear window'
  const labels: Array<[CapacityBlockKind, string]> = [
    ['booked', 'booked'],
    ['temporary_unavailability', 'unavailable'],
    ['personal_leave', 'leave'],
    ['recurring_unavailability', 'recurring'],
    ['school', 'school'],
  ]
  const detail = labels
    .flatMap(([key, label]) => window.blockedBy[key] ? [`${window.blockedBy[key]} ${label}`] : [])
    .join(', ')
  return `${window.blockedCount} blocked${detail ? ` · ${detail}` : ''}`
}

export default function CapacityFinder({
  team,
  timezone,
  onClose,
  onChoose,
}: {
  team: ScheduleTeamMember[]
  timezone: string
  onClose: () => void
  onChoose: (input: { start: Date; durationMinutes: number; assigneeIds: string[] }) => void
}) {
  const [date, setDate] = useState(() => operationalDateKey(new Date(Date.now() + 86_400_000), timezone))
  const [durationMinutes, setDurationMinutes] = useState(120)
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])
  const [windows, setWindows] = useState<CapacityWindow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const requestedWindows = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
    return HOURS.map((hour) => {
      const start = operationalInputToUtc(`${date}T${String(hour).padStart(2, '0')}:00`, timezone)
      const end = new Date(start.getTime() + durationMinutes * 60_000)
      return { start, end }
    })
  }, [date, durationMinutes, timezone])

  useEffect(() => {
    if (!requestedWindows.length) {
      setWindows([])
      setError('')
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void api<CapacityResponse>('/api/schedule-capacity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        windows: requestedWindows.map((window) => ({ start: window.start.toISOString(), end: window.end.toISOString() })),
        userIds: assigneeIds.length ? assigneeIds : undefined,
      }),
    }).then((result) => {
      if (!controller.signal.aborted) setWindows(result.windows)
    }).catch((cause) => {
      if (controller.signal.aborted) return
      setWindows([])
      setError(cause instanceof Error ? cause.message : 'Could not check capacity.')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [assigneeIds, requestedWindows])

  return <section className="schedule-popover find-time" aria-label="Find a workable visit window">
    <header><div><span className="eyebrow">Capacity finder</span><h2>Find a workable time</h2></div><button className="text-button" onClick={onClose}>Close</button></header>
    <div className="find-time-controls compact"><label>Date<input type="date" value={date} aria-invalid={!date} onChange={(event) => setDate(event.target.value)} /></label><DurationField value={durationMinutes} onChange={setDurationMinutes} /></div>
    <TeamPicker members={team} selectedIds={assigneeIds} onChange={setAssigneeIds} label="Check availability for" helper="Leave empty to check all assignable staff." />
    {!date ? <div className="schedule-edit-error" role="alert"><span>Select a date to see workable times.</span></div> : null}
    {error ? <div className="schedule-edit-error" role="alert"><strong>Could not check capacity</strong><span>{error}</span></div> : null}
    {loading ? <p className="muted">Checking school, leave, recurring availability and existing work…</p> : null}
    <div className="find-time-slots compact">
      {!loading && windows.map((slot) => {
        const start = new Date(slot.start)
        const end = new Date(slot.end)
        return <button key={slot.start} className={slot.blockedCount ? 'has-conflict' : ''} onClick={() => onChoose({ start, durationMinutes, assigneeIds })}>
          <b>{formatOperationalTime(start, timezone)}–{formatOperationalTime(end, timezone)}</b>
          <span>{slot.available}/{slot.total} available · {blockerSummary(slot)}</span>
        </button>
      })}
    </div>
  </section>
}
