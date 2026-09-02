'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { operationalCalendarDate } from '../../lib/operational-time'
import { readScheduleContext, writeScheduleContext, type ScheduleView } from './schedule-context'

export function useScheduleContext(timezone: string) {
  const search = useSearchParams().toString()
  const [today] = useState(() => operationalCalendarDate(new Date(), timezone))
  const context = useMemo(() => readScheduleContext(new URLSearchParams(search), timezone, today), [search, timezone, today])
  function update(values: Parameters<typeof writeScheduleContext>[1]) {
    const url = new URL(window.location.href)
    // Persist defaults on the old entry so Back does not change its date at midnight.
    if (!url.searchParams.has('date')) {
      url.search = writeScheduleContext(url.searchParams, { date: context.date }).toString()
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
    url.search = writeScheduleContext(url.searchParams, values).toString()
    window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }
  return {
    search, view: context.view, anchorDate: context.date, teamFilter: context.team,
    setView: (view: ScheduleView) => update({ view }),
    setAnchorDate: (date: Date) => update({ date }),
    setTeamFilter: (team: string) => update({ team }),
  }
}
