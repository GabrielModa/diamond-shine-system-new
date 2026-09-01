'use client'

import { useEffect, useMemo, useState } from 'react'
import { operationalInputToUtc } from '../../lib/operational-time'
import type { ScheduleTeamMember } from './TeamPicker'

type FinderState = { date: string; durationMinutes: number; assigneeIds: string[] }
type BlockKind = 'booked' | 'temporary_unavailability' | 'personal_leave' | 'recurring_unavailability' | 'school'
type CapacityWindow = {
  start: string
  end: string
  total: number
  available: number
  blockedCount: number
  blockedBy: Record<BlockKind, number>
}
type CapacityResponse = { windows: CapacityWindow[] }
type SuggestedTime = { start: Date; end: Date; free: number; total: number; conflicts: number; blockerLabel: string }

const HOURS = [7, 9, 11, 13, 15, 17]

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) throw new Error(body?.error ?? 'Request failed')
  return body.data as T
}

function blockerLabel(window: CapacityWindow) {
  if (!window.blockedCount) return 'clear window'
  const parts = [
    window.blockedBy.booked ? `${window.blockedBy.booked} booked` : '',
    window.blockedBy.temporary_unavailability ? `${window.blockedBy.temporary_unavailability} unavailable` : '',
    window.blockedBy.personal_leave ? `${window.blockedBy.personal_leave} leave` : '',
    window.blockedBy.recurring_unavailability ? `${window.blockedBy.recurring_unavailability} recurring` : '',
    window.blockedBy.school ? `${window.blockedBy.school} school` : '',
  ].filter(Boolean)
  return parts.join(', ') || `${window.blockedCount} blocked`
}

export function useScheduleCapacity(
  finder: FinderState,
  team: ScheduleTeamMember[],
  timezone: string,
) {
  const requestedWindows = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(finder.date)) return []
    return HOURS.map((hour) => {
      const start = operationalInputToUtc(`${finder.date}T${String(hour).padStart(2, '0')}:00`, timezone)
      const end = new Date(start.getTime() + finder.durationMinutes * 60_000)
      return { start, end }
    })
  }, [finder.date, finder.durationMinutes, timezone])

  const [state, setState] = useState<{ key: string; slots: SuggestedTime[] }>({ key: '', slots: [] })
  const selectedIds = finder.assigneeIds.length ? finder.assigneeIds : team.map((member) => member.id)
  const requestKey = `${requestedWindows.map((window) => window.start.toISOString()).join(',')}|${finder.durationMinutes}|${selectedIds.join(',')}`

  useEffect(() => {
    if (!requestedWindows.length) {
      setState({ key: requestKey, slots: [] })
      return
    }
    const controller = new AbortController()
    void api<CapacityResponse>('/api/schedule-capacity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        windows: requestedWindows.map((window) => ({ start: window.start.toISOString(), end: window.end.toISOString() })),
        userIds: finder.assigneeIds.length ? finder.assigneeIds : undefined,
      }),
    }).then((result) => {
      if (controller.signal.aborted) return
      setState({
        key: requestKey,
        slots: result.windows.map((window) => ({
          start: new Date(window.start),
          end: new Date(window.end),
          free: window.available,
          total: window.total,
          conflicts: window.blockedCount,
          blockerLabel: blockerLabel(window),
        })),
      })
    }).catch(() => {
      if (!controller.signal.aborted) setState({ key: requestKey, slots: [] })
    })
    return () => controller.abort()
  }, [finder.assigneeIds, requestKey, requestedWindows])

  return state.key === requestKey ? state.slots : []
}
