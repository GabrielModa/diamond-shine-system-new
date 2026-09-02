'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { calendarDateKey, formatOperationalTime, operationalCalendarDate, operationalDateKey, operationalDateTimeInput, operationalInputToUtc } from '../../lib/operational-time'
import { formatDuration } from '../../lib/duration'
import { isActiveAssignmentStatus as isActiveAssignment, isOperationalVisitStatus } from '../../modules/scheduling/assignment-lifecycle'
import ScheduleHealthPanel from './ScheduleHealthPanel'
import DateTimeField12h from '../ui/DateTimeField12h'
import DurationField from '../ui/DurationField'
import StandardSelect from '../ui/StandardSelect'
import TeamPicker from './TeamPicker'
import { useScheduleCapacity } from './useScheduleCapacity'
import { useScheduleContext } from './useScheduleContext'
import { visitAttention } from './visit-attention'
import './ScheduleFocus.css'

type Plan = {
  id: string
  name: string
  status: string
  expectedDurationMinutes: number
  requiredWorkers: number
  site: { id: string; name: string; city: string; client: { id: string; displayName: string } }
}
type Member = { id: string; name: string | null; email: string; role: string }
type Visit = {
  id: string
  scheduledStart: string
  scheduledEnd: string
  status: string
  version: number
  requiredWorkers: number
  dispatchNotes?: string | null
  cancellationReason?: string | null
  site: { name: string; city: string; client: { displayName: string } }
  job: { name: string }
  assignments: Array<{ status: string; user: Member }>
}
type Availability = { id: string; startsAt: string; endsAt: string; reason?: string | null; user: Member }
type HealthFocus = 'scheduling' | 'conflicts' | 'confirmation' | null
type AssignmentState = { kind: 'busy' | 'unavailable'; label: string; visitId?: string; clientName?: string; siteName?: string; startsAt?: string; endsAt?: string; overlapMinutes?: number }
type VisitReason = 'extra_cleaning' | 'client_request' | 'cover_visit' | 'deep_clean' | 'other'

const REASONS: Array<{ value: VisitReason; label: string; description: string }> = [
  { value: 'extra_cleaning', label: 'Extra cleaning', description: 'An additional clean outside the normal service pattern.' },
  { value: 'client_request', label: 'Client request', description: 'The client asked for an extra visit.' },
  { value: 'cover_visit', label: 'Cover visit', description: 'Operational cover without changing the recurring service.' },
  { value: 'deep_clean', label: 'Deep clean', description: 'A one-off deeper service using the configured checklist.' },
  { value: 'other', label: 'Other', description: 'Another one-off operational reason.' },
]

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) throw new Error(body?.error ?? 'Request failed')
  return body.data as T
}

function startOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1) }
function sameDay(instant: Date, calendarDate: Date, timezone: string) { return operationalDateKey(instant, timezone) === calendarDateKey(calendarDate) }
function initials(member: Member) { return (member.name ?? member.email).split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() }
function timeRange(start: Date, end: Date, timezone: string) { return `${formatOperationalTime(start, timezone)}–${formatOperationalTime(end, timezone)}` }
function isTerminalVisit(status: string) { return status === 'cancelled' || status === 'missed' }

export default function ScheduleDispatchBoard({ canManage, timezone }: { canManage: boolean; timezone: string }) {
  const { search, view, setView, anchorDate, setAnchorDate, teamFilter, setTeamFilter } = useScheduleContext(timezone)
  const [visits, setVisits] = useState<Visit[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [team, setTeam] = useState<Member[]>([])
  const [availability, setAvailability] = useState<Availability[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [statusFilter, setStatusFilter] = useState('attention')
  const [healthFocus, setHealthFocus] = useState<HealthFocus>(null)
  const [healthRefreshSignal, setHealthRefreshSignal] = useState(0)
  const [healthCloseSignal, setHealthCloseSignal] = useState(0)
  const [draftTeamFilter, setDraftTeamFilter] = useState('all')
  const [teamQuery, setTeamQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showFindTime, setShowFindTime] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [selected, setSelected] = useState<Visit | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [edit, setEdit] = useState({ scheduledStart: '', scheduledEnd: '', assigneeIds: [] as string[], dispatchNotes: '', cancellationReason: '' })
  const [draft, setDraft] = useState({
    servicePlanId: '',
    startAt: operationalDateTimeInput(new Date(Date.now() + 86_400_000), timezone),
    durationMinutes: 120,
    requiredWorkers: 1,
    assigneeIds: [] as string[],
    reason: 'extra_cleaning' as VisitReason,
    dispatchNotes: '',
  })
  const [finder, setFinder] = useState({ date: operationalDateKey(new Date(Date.now() + 86_400_000), timezone), durationMinutes: 120, assigneeIds: [] as string[] })

  const range = useMemo(() => {
    const start = startOfMonth(anchorDate); start.setDate(start.getDate() - 7)
    const end = new Date(start); end.setMonth(end.getMonth() + 3)
    return {
      from: operationalInputToUtc(`${calendarDateKey(start)}T00:00`, timezone).toISOString(),
      to: operationalInputToUtc(`${calendarDateKey(end)}T23:59`, timezone).toISOString(),
    }
  }, [anchorDate, timezone])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [visitRows, planRows, teamRows, availabilityRows] = await Promise.all([
        api<Visit[]>(`/api/visits?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&mode=all`),
        api<Plan[]>('/api/service-plans'),
        api<Member[]>('/api/team'),
        api<Availability[]>(`/api/availability?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
      ])
      const activePlans = planRows.filter((plan) => plan.status === 'published')
      setVisits(visitRows)
      setPlans(activePlans)
      setTeam(teamRows)
      setAvailability(availabilityRows)
      setDraft((current) => {
        const selectedPlan = activePlans.find((plan) => plan.id === current.servicePlanId) ?? activePlans[0]
        if (!selectedPlan) return { ...current, servicePlanId: '' }
        if (current.servicePlanId) return current
        return { ...current, servicePlanId: selectedPlan.id, durationMinutes: selectedPlan.expectedDurationMinutes, requiredWorkers: selectedPlan.requiredWorkers }
      })
    } catch (error) {
      setNoticeIsError(true)
      setNotice(error instanceof Error ? error.message : 'Could not load schedule.')
    } finally { setLoading(false) }
  }, [range.from, range.to])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    setDraftTeamFilter(teamFilter)
    setHealthFocus(null)
    if (teamFilter !== 'all') setStatusFilter('upcoming')
  }, [teamFilter])
  useEffect(() => {
    const visitId = new URLSearchParams(window.location.search).get('visit')
    if (!visitId || selected?.id === visitId) return
    const visit = visits.find((item) => item.id === visitId)
    if (visit) selectVisit(visit)
  }, [search, selected?.id, visits])
  useEffect(() => {
    if (!showAdd && !selected && !showFindTime && !showFilters) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [selected, showAdd, showFilters, showFindTime])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (selected) { event.preventDefault(); dismissSelected(); return }
      if (showAdd) { event.preventDefault(); setShowAdd(false); return }
      if (showFindTime) { event.preventDefault(); setShowFindTime(false); return }
      if (showFilters) { event.preventDefault(); dismissFilters() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selected, showAdd, showFilters, showFindTime])

  const visibleWindow = useMemo(() => {
    const start = new Date(anchorDate)
    if (view === 'week') start.setDate(anchorDate.getDate() - anchorDate.getDay())
    else if (view === 'month' || view === 'list') start.setDate(1)
    const end = new Date(start)
    if (view === 'week') end.setDate(start.getDate() + 7)
    else if (view === 'day') end.setDate(start.getDate() + 1)
    else end.setMonth(start.getMonth() + 1)
    return {
      from: operationalInputToUtc(`${calendarDateKey(start)}T00:00`, timezone),
      to: operationalInputToUtc(`${calendarDateKey(end)}T00:00`, timezone),
    }
  }, [anchorDate, timezone, view])
  const visitsInVisibleRange = useMemo(() => visits.filter((visit) => {
    const start = new Date(visit.scheduledStart)
    return start >= visibleWindow.from && start < visibleWindow.to
  }), [visibleWindow, visits])
  const focusedEmployeeId = teamFilter !== 'all' && teamFilter !== 'unassigned' ? teamFilter : null
  const visitHasConflict = useCallback((visit: Visit, employeeId?: string | null) => {
    if (!isOperationalVisitStatus(visit.status)) return false
    const assigned = new Set(visit.assignments.filter((assignment) => isActiveAssignment(assignment.status) && (!employeeId || assignment.user.id === employeeId)).map((assignment) => assignment.user.id))
    if (!assigned.size) return false
    const start = new Date(visit.scheduledStart); const end = new Date(visit.scheduledEnd)
    return visits.some((other) => other.id !== visit.id && isOperationalVisitStatus(other.status) && new Date(other.scheduledStart) < end && new Date(other.scheduledEnd) > start && other.assignments.some((assignment) => assigned.has(assignment.user.id) && isActiveAssignment(assignment.status)))
  }, [visits])
  const visibleVisits = useMemo(() => visitsInVisibleRange.filter((visit) => {
    const activeAssignments = visit.assignments.filter((assignment) => isActiveAssignment(assignment.status))
    const attention = visitAttention(visit, visitHasConflict(visit, focusedEmployeeId), focusedEmployeeId)
    const historical = !isOperationalVisitStatus(visit.status)
    const statusMatch = healthFocus ? !historical : statusFilter === 'attention' ? attention.any : statusFilter === 'upcoming' ? !historical : statusFilter === 'history' ? historical : visit.status === statusFilter
    const healthMatch = healthFocus ? attention[healthFocus] : true
    const teamMatch = teamFilter === 'all' || (teamFilter === 'unassigned' ? activeAssignments.length === 0 : activeAssignments.some((assignment) => assignment.user.id === teamFilter))
    return statusMatch && healthMatch && teamMatch
  }), [focusedEmployeeId, healthFocus, statusFilter, teamFilter, visitHasConflict, visitsInVisibleRange])
  const attentionVisitCount = useMemo(() => visitsInVisibleRange.filter((visit) => {
    if (!isOperationalVisitStatus(visit.status)) return false
    const activeAssignments = visit.assignments.filter((assignment) => isActiveAssignment(assignment.status))
    if (!visitAttention(visit, visitHasConflict(visit, focusedEmployeeId), focusedEmployeeId).any) return false
    if (teamFilter === 'all') return true
    if (teamFilter === 'unassigned') return activeAssignments.length === 0
    return activeAssignments.some((assignment) => assignment.user.id === teamFilter)
  }).length, [focusedEmployeeId, teamFilter, visitHasConflict, visitsInVisibleRange])
  const grouped = useMemo(() => visibleVisits.reduce<Record<string, Visit[]>>((acc, visit) => {
    const key = new Date(visit.scheduledStart).toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'short', timeZone: timezone })
    ;(acc[key] ??= []).push(visit)
    return acc
  }, {}), [timezone, visibleVisits])
  const monthDays = useMemo(() => {
    const first = startOfMonth(anchorDate); const gridStart = new Date(first); gridStart.setDate(first.getDate() - first.getDay())
    return Array.from({ length: 42 }, (_, index) => { const date = new Date(gridStart); date.setDate(gridStart.getDate() + index); return date })
  }, [anchorDate])
  const weekDays = useMemo(() => {
    const start = new Date(anchorDate); start.setDate(anchorDate.getDate() - anchorDate.getDay())
    return Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date })
  }, [anchorDate])
  const title = view === 'month' || view === 'list'
    ? anchorDate.toLocaleDateString('en-IE', { month: 'long', year: 'numeric' })
    : view === 'week'
      ? `${weekDays[0].toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })} – ${weekDays[6].toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : anchorDate.toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const capacity = useScheduleCapacity(finder, team, timezone, visits.length, showFindTime)
  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === draft.servicePlanId) ?? null, [draft.servicePlanId, plans])
  const filteredTeamChoices = useMemo(() => {
    const needle = teamQuery.trim().toLowerCase()
    return needle ? team.filter((member) => `${member.name ?? ''} ${member.email}`.toLowerCase().includes(needle)) : team
  }, [team, teamQuery])

  const assignmentState = useCallback((userId: string, startValue: string, endValue: string, ignoredVisitId?: string): AssignmentState | null => {
    const start = operationalInputToUtc(startValue, timezone); const end = operationalInputToUtc(endValue, timezone)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null
    const unavailable = availability.find((entry) => entry.user.id === userId && new Date(entry.startsAt) < end && new Date(entry.endsAt) > start)
    if (unavailable) return { kind: 'unavailable', label: `Unavailable · ${timeRange(new Date(unavailable.startsAt), new Date(unavailable.endsAt), timezone)}` }
    const visit = visits.find((item) => item.id !== ignoredVisitId && isOperationalVisitStatus(item.status) && new Date(item.scheduledStart) < end && new Date(item.scheduledEnd) > start && item.assignments.some((assignment) => assignment.user.id === userId && isActiveAssignment(assignment.status)))
    if (!visit) return null
    const visitStart = new Date(visit.scheduledStart); const visitEnd = new Date(visit.scheduledEnd)
    return {
      kind: 'busy',
      label: `Busy · ${timeRange(visitStart, visitEnd, timezone)} at ${visit.site.client.displayName} · ${visit.site.name}`,
      visitId: visit.id, clientName: visit.site.client.displayName, siteName: visit.site.name,
      startsAt: visit.scheduledStart, endsAt: visit.scheduledEnd,
      overlapMinutes: Math.max(1, Math.round((Math.min(end.getTime(), visitEnd.getTime()) - Math.max(start.getTime(), visitStart.getTime())) / 60_000)),
    }
  }, [availability, timezone, visits])
  const editStates = useMemo(() => new Map(team.map((member) => [member.id, assignmentState(member.id, edit.scheduledStart, edit.scheduledEnd, selected?.id)])), [assignmentState, edit.scheduledStart, edit.scheduledEnd, selected?.id, team])
  const editConflicts = useMemo(() => edit.assigneeIds.flatMap((userId) => {
    const state = editStates.get(userId)
    if (!state || state.kind !== 'busy') return []
    const member = team.find((candidate) => candidate.id === userId)
    return [{ userId, name: member?.name ?? member?.email ?? 'Cleaner', state }]
  }), [edit.assigneeIds, editStates, team])

  function closeHealth() { setHealthCloseSignal((value) => value + 1) }
  function prepareMajorSurface() { closeHealth(); setShowFindTime(false); setShowFilters(false); window.dispatchEvent(new Event('diamond:close-nav')) }
  function clearHealthFocus(nextStatus: string) { setHealthFocus(null); setStatusFilter(nextStatus) }
  function changeHealthFocus(focus: HealthFocus) { setShowFindTime(false); setShowFilters(false); setHealthFocus(focus); setStatusFilter('attention') }
  function movePeriod(direction: number) {
    const next = new Date(anchorDate)
    if (view === 'month' || view === 'list') next.setMonth(next.getMonth() + direction)
    else if (view === 'week') next.setDate(next.getDate() + 7 * direction)
    else next.setDate(next.getDate() + direction)
    setAnchorDate(next)
  }
  function dismissFilters() { setDraftTeamFilter(teamFilter); setTeamQuery(''); setShowFilters(false) }
  function applyFilters() { setTeamFilter(draftTeamFilter); setTeamQuery(''); setShowFilters(false); setHealthRefreshSignal((value) => value + 1) }
  function openAddFor(date: Date) {
    prepareMajorSurface()
    const plan = selectedPlan ?? plans[0]
    setDraft((current) => ({
      ...current,
      servicePlanId: plan?.id ?? current.servicePlanId,
      startAt: `${calendarDateKey(date)}T09:00`,
      durationMinutes: plan?.expectedDurationMinutes ?? current.durationMinutes,
      requiredWorkers: plan?.requiredWorkers ?? current.requiredWorkers,
      assigneeIds: focusedEmployeeId ? [focusedEmployeeId] : [],
      dispatchNotes: '',
    }))
    setAnchorDate(date)
    setShowAdd(true)
  }
  function selectPlan(planId: string) {
    const plan = plans.find((item) => item.id === planId)
    setDraft((current) => ({ ...current, servicePlanId: planId, durationMinutes: plan?.expectedDurationMinutes ?? current.durationMinutes, requiredWorkers: plan?.requiredWorkers ?? current.requiredWorkers }))
  }
  async function addVisit(event: FormEvent) {
    event.preventDefault()
    if (!draft.servicePlanId) return
    setBusy(true); setNotice(null)
    try {
      await api('/api/visits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          servicePlanId: draft.servicePlanId,
          scheduledStart: operationalInputToUtc(draft.startAt, timezone).toISOString(),
          durationMinutes: draft.durationMinutes,
          requiredWorkers: draft.requiredWorkers,
          assigneeIds: draft.assigneeIds,
          reason: draft.reason,
          dispatchNotes: draft.dispatchNotes || null,
        }),
      })
      setNoticeIsError(false); setNotice('Visit added to Schedule. The client service pattern was not changed.')
      setShowAdd(false)
      await refresh(); setHealthRefreshSignal((value) => value + 1)
    } catch (error) {
      setNoticeIsError(true); setNotice(error instanceof Error ? error.message : 'Could not add this visit.')
    } finally { setBusy(false) }
  }
  function selectVisit(visit: Visit) {
    prepareMajorSurface(); setEditError(null); setSelected(visit)
    setEdit({
      scheduledStart: operationalDateTimeInput(new Date(visit.scheduledStart), timezone),
      scheduledEnd: operationalDateTimeInput(new Date(visit.scheduledEnd), timezone),
      assigneeIds: visit.assignments.filter((assignment) => isActiveAssignment(assignment.status)).map((assignment) => assignment.user.id),
      dispatchNotes: visit.dispatchNotes ?? '', cancellationReason: visit.cancellationReason ?? '',
    })
  }
  function dismissSelected() {
    setEditError(null); setSelected(null)
    const url = new URL(window.location.href)
    if (url.searchParams.has('visit')) { url.searchParams.delete('visit'); window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`) }
  }
  function openHealthVisit(visitId: string) {
    const visit = visits.find((item) => item.id === visitId)
    if (visit) selectVisit(visit)
    else { setNoticeIsError(true); setNotice('This visit is outside the current schedule window. Refresh and try again.') }
  }
  function openServiceConfiguration(servicePlanId: string) {
    const plan = plans.find((item) => item.id === servicePlanId)
    if (plan) window.location.assign(`/clients/${plan.site.client.id}`)
    else window.location.assign('/clients')
  }
  async function saveVisit(status?: 'scheduled' | 'cancelled') {
    if (!selected) return
    setEditError(null)
    if (status === 'cancelled' && !edit.cancellationReason.trim()) return setEditError('Add a cancellation reason before cancelling this visit.')
    if (isTerminalVisit(selected.status) || selected.status === 'completed') return setEditError('Historical visits are read-only in the operational schedule.')
    if (status !== 'cancelled') {
      const blocked = edit.assigneeIds.flatMap((userId) => {
        const state = editStates.get(userId); if (!state) return []
        const member = team.find((candidate) => candidate.id === userId)
        return [{ name: member?.name ?? member?.email ?? 'Cleaner', state }]
      })
      if (blocked.length) return setEditError(blocked.map(({ name, state }) => `${name} is ${state.label.toLowerCase()}.`).join(' '))
    }
    setBusy(true)
    try {
      await api(`/api/visits/${selected.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          version: selected.version,
          scheduledStart: operationalInputToUtc(edit.scheduledStart, timezone).toISOString(),
          scheduledEnd: operationalInputToUtc(edit.scheduledEnd, timezone).toISOString(),
          assigneeIds: edit.assigneeIds,
          dispatchNotes: edit.dispatchNotes || null,
          status,
          cancellationReason: status === 'cancelled' ? edit.cancellationReason.trim() : null,
        }),
      })
      setNoticeIsError(false); setNotice(status === 'cancelled' ? 'Visit cancelled. History was retained.' : 'Visit updated and the assigned team has been notified.')
      dismissSelected(); await refresh(); setHealthRefreshSignal((value) => value + 1)
    } catch (error) { setEditError(error instanceof Error ? error.message : 'Could not update this visit.') }
    finally { setBusy(false) }
  }

  const renderVisit = (visit: Visit, compact = false) => {
    const activeAssignments = visit.assignments.filter((assignment) => isActiveAssignment(assignment.status))
    const coverage = `${activeAssignments.length}/${visit.requiredWorkers}`
    const conflicted = visitHasConflict(visit, focusedEmployeeId)
    const attention = visitAttention(visit, conflicted, focusedEmployeeId)
    return <button type="button" className={`visit-card visit-card-button${compact ? ' compact' : ''}${activeAssignments.length < visit.requiredWorkers ? ' coverage-gap' : ''}${conflicted ? ' schedule-conflict' : ''}`} key={visit.id} data-attention={attention.tone} data-status={visit.status} onClick={() => selectVisit(visit)}>
      <time><span>{formatOperationalTime(visit.scheduledStart, timezone)}</span><span>→ {formatOperationalTime(visit.scheduledEnd, timezone)}</span></time>
      <div><strong>{compact ? visit.site.client.displayName : `${visit.site.client.displayName} · ${visit.job.name}`}</strong>{!compact ? <><div>{visit.site.name}</div><small>{visit.site.city} · {formatDuration(Math.round((new Date(visit.scheduledEnd).getTime() - new Date(visit.scheduledStart).getTime()) / 60000))} shift</small></> : <small className="visit-coverage">{formatDuration(Math.round((new Date(visit.scheduledEnd).getTime() - new Date(visit.scheduledStart).getTime()) / 60000))} shift · Team {coverage}</small>}<span className="visit-attention-labels">{attention.conflicts ? <small>Conflict</small> : null}{attention.scheduling ? <small>Team needed</small> : null}{attention.confirmation ? <small>Awaiting confirmation</small> : null}</span></div>
      {!compact ? <div className="visit-team">{activeAssignments.length ? activeAssignments.map((assignment) => <span key={assignment.user.id}>{initials(assignment.user)}</span>) : <em>Unassigned</em>}<small className="visit-coverage">{coverage} covered</small></div> : null}
    </button>
  }

  return <main className="page-shell schedule-page">
    <header className="page-header schedule-hero"><div><span className="eyebrow">Dispatch control</span><h1>Schedule</h1><p className="muted">Operate visits from configured client services. Recurring service rules are managed in the Client Account.</p></div>{canManage ? <button className="btn-primary" onClick={() => openAddFor(anchorDate)}>+ Add visit</button> : null}</header>

    <section className="schedule-focus-tabs" aria-label="Schedule focus">
      <button className={statusFilter === 'attention' ? 'selected' : ''} onClick={() => clearHealthFocus('attention')}>Needs attention</button>
      <button className={!healthFocus && statusFilter === 'upcoming' ? 'selected' : ''} onClick={() => clearHealthFocus('upcoming')}>Upcoming</button>
      <button className={!healthFocus && statusFilter === 'history' ? 'selected' : ''} onClick={() => clearHealthFocus('history')}>History</button>
    </section>

    <section className="scheduler-controls" aria-label="Schedule controls">
      <div className="scheduler-period"><button className="btn-secondary" aria-label="Previous period" onClick={() => movePeriod(-1)}>←</button><button className="btn-secondary" aria-label="Next period" onClick={() => movePeriod(1)}>→</button><button className="btn-secondary" onClick={() => setAnchorDate(operationalCalendarDate(new Date(), timezone))}>Today</button><strong>{title}</strong></div>
      <div className="scheduler-filters">
        <div className="schedule-tool-anchor">{canManage ? <button className={showFindTime ? 'btn-primary' : 'btn-secondary'} onClick={() => { closeHealth(); setShowFilters(false); if (!showFindTime) setFinder((current) => ({ ...current, date: calendarDateKey(anchorDate), assigneeIds: focusedEmployeeId ? [focusedEmployeeId] : [] })); setShowFindTime((value) => !value) }}>Find a time</button> : null}
          {showFindTime ? <section className="schedule-popover find-time" aria-label="Find a workable visit window"><header><div><span className="eyebrow">Capacity finder</span><h2>Find a workable time</h2></div><button className="text-button" onClick={() => setShowFindTime(false)}>Close</button></header><div className="find-time-controls compact"><label>Date<input type="date" value={finder.date} onChange={(event) => setFinder({ ...finder, date: event.target.value })} /></label><DurationField value={finder.durationMinutes} onChange={(durationMinutes) => setFinder({ ...finder, durationMinutes })} /></div><TeamPicker members={team} selectedIds={finder.assigneeIds} onChange={(assigneeIds) => setFinder({ ...finder, assigneeIds })} label="Check availability for" helper="Leave empty to check all assignable staff." />{!finder.date ? <div className="schedule-edit-error" role="alert">Select a date to see workable times.</div> : null}{capacity.loading ? <p>Checking availability…</p> : null}{capacity.error ? <p role="alert">{capacity.error}</p> : null}<div className="find-time-slots compact">{capacity.slots.map((slot) => <button key={slot.start.toISOString()} onClick={() => { setDraft((current) => ({ ...current, startAt: operationalDateTimeInput(slot.start, timezone), durationMinutes: finder.durationMinutes, assigneeIds: finder.assigneeIds })); setAnchorDate(operationalCalendarDate(slot.start, timezone)); setView('day'); setShowFindTime(false); setShowAdd(true) }}><b>{formatOperationalTime(slot.start, timezone)}–{formatOperationalTime(slot.end, timezone)}</b><span>{slot.free} available · {slot.blockerLabel}</span></button>)}</div></section> : null}
        </div>
        <div className="schedule-tool-anchor"><button className={showFilters ? 'btn-primary' : 'btn-secondary'} onClick={() => showFilters ? dismissFilters() : (setDraftTeamFilter(teamFilter), setTeamQuery(''), setShowFilters(true))}>Filters{teamFilter !== 'all' ? ' · 1' : ''}</button>{showFilters ? <section className="schedule-popover schedule-filter-popover" role="dialog" aria-modal="true" aria-label="Schedule filters"><header><h2>Filters</h2><button className="text-button" onClick={dismissFilters}>Close</button></header><label>Team<input type="search" value={teamQuery} onChange={(event) => setTeamQuery(event.target.value)} placeholder="Search employee..." /></label><div className="schedule-filter-team"><button className={draftTeamFilter === 'all' ? 'selected' : ''} onClick={() => setDraftTeamFilter('all')}>All team</button><button className={draftTeamFilter === 'unassigned' ? 'selected' : ''} onClick={() => setDraftTeamFilter('unassigned')}>Unassigned only</button>{filteredTeamChoices.map((member) => <button key={member.id} className={draftTeamFilter === member.id ? 'selected' : ''} onClick={() => setDraftTeamFilter(member.id)}>{member.name ?? member.email}</button>)}</div><footer><button className="text-button" onClick={() => setDraftTeamFilter('all')}>Clear</button><button className="btn-primary" onClick={applyFilters}>Apply</button></footer></section> : null}</div>
        <div className="segmented-control schedule-view-tabs">{(['week', 'day', 'month', 'list'] as const).map((item) => <button key={item} className={view === item ? 'selected' : ''} onClick={() => setView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
      </div>
    </section>

    {notice ? <div className={`toast ${noticeIsError ? 'error' : 'success'}`} role={noticeIsError ? 'alert' : 'status'}>{notice}<button className="notice-close" onClick={() => setNotice(null)}>×</button></div> : null}
    {canManage ? <ScheduleHealthPanel from={visibleWindow.from.toISOString()} to={visibleWindow.to.toISOString()} timezone={timezone} teamScope={teamFilter} focus={healthFocus} attentionView={statusFilter === 'attention'} attentionVisitCount={attentionVisitCount} canManage={canManage} closeSignal={healthCloseSignal} refreshSignal={healthRefreshSignal} onChanged={refresh} onFocusChange={changeHealthFocus} onOpenVisit={openHealthVisit} onOpenServicePlan={openServiceConfiguration} /> : null}

    {showAdd ? <div className="modal-overlay active schedule-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAdd(false) }}><form className="schedule-create card schedule-sheet" onSubmit={addVisit} role="dialog" aria-modal="true" aria-labelledby="add-visit-title"><header><div><span className="eyebrow">One-off operational visit</span><h2 id="add-visit-title">Add visit</h2><p className="muted">Add one occurrence without changing the client’s recurring service. To change frequency, days or the contract, use the Client Account.</p></div><button type="button" className="btn-secondary" onClick={() => setShowAdd(false)}>Close</button></header>
      {plans.length ? <>
        <div className="service-plan-field"><span className="service-plan-label">Client service</span><StandardSelect searchable value={draft.servicePlanId} onChange={selectPlan} ariaLabel="Client service" placeholder="Select client service" searchPlaceholder="Search client, location or service…" options={plans.map((plan) => ({ value: plan.id, label: `${plan.site.client.displayName} · ${plan.site.name}`, description: `${plan.name} · ${formatDuration(plan.expectedDurationMinutes)} · ${plan.requiredWorkers} people required` }))} /></div>
        <div className="form-pair"><div className="service-plan-field"><span className="service-plan-label">Reason</span><StandardSelect value={draft.reason} onChange={(value) => setDraft((current) => ({ ...current, reason: value as VisitReason }))} ariaLabel="Visit reason" options={REASONS} /></div><DateTimeField12h label="Visit start" required value={draft.startAt} onChange={(value) => setDraft((current) => ({ ...current, startAt: value }))} /></div>
        <div className="form-pair"><DurationField value={draft.durationMinutes} onChange={(durationMinutes) => setDraft((current) => ({ ...current, durationMinutes }))} /><label>People required<input required type="number" min={1} max={100} value={draft.requiredWorkers} onChange={(event) => setDraft((current) => ({ ...current, requiredWorkers: Math.max(1, Number(event.target.value)) }))} /></label></div>
        <div className="schedule-team-field"><TeamPicker members={team} selectedIds={draft.assigneeIds} onChange={(assigneeIds) => setDraft((current) => ({ ...current, assigneeIds }))} label="Assigned cleaning team" helper={`${draft.assigneeIds.length}/${draft.requiredWorkers} covered now. Leave empty to create the visit as a staffing gap.`} /></div>
        <label className="schedule-full-field">Dispatch note <small>Optional</small><textarea value={draft.dispatchNotes} onChange={(event) => setDraft((current) => ({ ...current, dispatchNotes: event.target.value }))} placeholder="Only what the team needs to know for this extra visit" /></label>
        <footer><span className="muted">One visit only · recurring service stays unchanged{selectedPlan ? ` · ${selectedPlan.site.client.displayName}` : ''}</span><button className="btn-primary" disabled={busy || !draft.servicePlanId}>{busy ? 'Adding…' : 'Add visit'}</button></footer>
      </> : <div className="empty-state"><strong>No active client service is available.</strong><span>Set up the client, verified address and cleaning service first.</span><a className="btn-primary" href="/clients">Open Clients</a></div>}
    </form></div> : null}

    {loading ? <section className="card empty-state">Loading schedule…</section> : null}
    {!loading ? <>
      {view === 'month' ? <section className="month-calendar card"><div className="calendar-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{monthDays.map((date) => { const rows = visibleVisits.filter((visit) => sameDay(new Date(visit.scheduledStart), date, timezone)); return <button className={`calendar-cell${date.getMonth() !== anchorDate.getMonth() ? ' muted-month' : ''}`} key={date.toISOString()} onClick={() => canManage ? openAddFor(date) : (setAnchorDate(date), setView('day'))}><span className="calendar-date">{date.getDate()}</span>{rows.slice(0, 2).map((visit) => <span data-attention={visitAttention(visit, visitHasConflict(visit, focusedEmployeeId), focusedEmployeeId).tone} className={`calendar-visit ${visit.status}`} key={visit.id}>{timeRange(new Date(visit.scheduledStart), new Date(visit.scheduledEnd), timezone)} {visit.site.client.displayName}</span>)}{rows.length > 2 ? <small>+{rows.length - 2} more</small> : null}</button>})}</div></section> : null}
      {view === 'week' ? <section className="week-calendar card">{weekDays.map((date) => { const rows = visibleVisits.filter((visit) => sameDay(new Date(visit.scheduledStart), date, timezone)); return <section className="week-column" key={date.toISOString()}><header><b>{date.toLocaleDateString('en-IE', { weekday: 'short' })}</b><strong>{date.getDate()}</strong><span>{rows.length} visit{rows.length === 1 ? '' : 's'}</span></header><div>{rows.map((visit) => renderVisit(visit, true))}{canManage ? <button className="week-empty" onClick={() => openAddFor(date)}>+ Add visit</button> : null}</div></section>})}</section> : null}
      {view === 'day' ? <section className="day-schedule card"><header><div><span className="eyebrow">{anchorDate.toLocaleDateString('en-IE', { weekday: 'long' })}</span><h2>{anchorDate.toLocaleDateString('en-IE', { day: 'numeric', month: 'long' })}</h2></div><div className="day-schedule-actions"><span>{visibleVisits.filter((visit) => sameDay(new Date(visit.scheduledStart), anchorDate, timezone)).length} visits</span>{canManage ? <button className="btn-secondary" onClick={() => openAddFor(anchorDate)}>+ Add visit</button> : null}</div></header>{visibleVisits.filter((visit) => sameDay(new Date(visit.scheduledStart), anchorDate, timezone)).map((visit) => renderVisit(visit))}{!visibleVisits.some((visit) => sameDay(new Date(visit.scheduledStart), anchorDate, timezone)) ? <div className="empty-state">No visits in this view.{canManage ? <button className="btn-primary" onClick={() => openAddFor(anchorDate)}>Add visit</button> : null}</div> : null}</section> : null}
      {view === 'list' ? <section className="schedule-board list"><aside className="schedule-summary"><strong>{visibleVisits.length}</strong><span>visits in range</span><div><b>{visibleVisits.filter((visit) => visit.status === 'completed').length}</b> complete</div><div><b>{visibleVisits.filter((visit) => !visit.assignments.some((assignment) => isActiveAssignment(assignment.status))).length}</b> unassigned</div></aside><div className="schedule-days">{Object.entries(grouped).map(([day, rows]) => <section className="schedule-day" key={day}><header><h2>{day}</h2><span>{rows.length} visit{rows.length === 1 ? '' : 's'}</span></header>{rows.map((visit) => renderVisit(visit))}</section>)}{!visibleVisits.length ? <div className="card empty-state">No visits match this view.</div> : null}</div></section> : null}

      {selected && canManage ? <div className="modal-overlay active schedule-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dismissSelected() }}><section className="schedule-edit card schedule-sheet schedule-edit-sheet" role="dialog" aria-modal="true" aria-labelledby="edit-visit-title"><header><div><span className="eyebrow">Dispatch action</span><h2 id="edit-visit-title">{selected.site.client.displayName} · {selected.site.name}</h2><p className="muted">Update this visit only. Recurring service settings remain in the Client Account.</p></div><button className="btn-secondary" onClick={dismissSelected}>Close</button></header>
        {editError ? <div className="schedule-edit-error" role="alert"><strong>Could not save this occurrence</strong><span>{editError}</span></div> : null}
        {editConflicts.length ? <div className="schedule-edit-error" role="alert"><strong>Schedule conflict</strong><span>{editConflicts.map((item) => item.name).join(', ')} is already assigned to overlapping work.</span></div> : null}
        <DateTimeField12h label="Start" value={edit.scheduledStart} onChange={(value) => { setEditError(null); setEdit((current) => ({ ...current, scheduledStart: value })) }} />
        <DateTimeField12h label="End" value={edit.scheduledEnd} onChange={(value) => { setEditError(null); setEdit((current) => ({ ...current, scheduledEnd: value })) }} />
        <div className="schedule-team-field"><TeamPicker members={team} selectedIds={edit.assigneeIds} onChange={(assigneeIds) => { setEditError(null); setEdit((current) => ({ ...current, assigneeIds })) }} label="Assigned cleaning team" helper={`${edit.assigneeIds.length}/${selected.requiredWorkers} currently covered`} /></div>
        <label className="schedule-full-field">Dispatch note<textarea aria-label="Dispatch note" value={edit.dispatchNotes} onChange={(event) => { setEditError(null); setEdit((current) => ({ ...current, dispatchNotes: event.target.value })) }} /></label>
        <label className="schedule-full-field">Cancellation reason<input value={edit.cancellationReason} onChange={(event) => { setEditError(null); setEdit((current) => ({ ...current, cancellationReason: event.target.value })) }} placeholder="Required before cancellation" /></label>
        <div className="schedule-edit-actions"><button className="btn-danger" disabled={busy || selected.status === 'completed' || isTerminalVisit(selected.status) || !edit.cancellationReason.trim()} onClick={() => void saveVisit('cancelled')}>Cancel visit</button><button className="btn-primary" disabled={busy || selected.status === 'completed' || isTerminalVisit(selected.status)} onClick={() => void saveVisit('scheduled')}>Save occurrence</button></div>
      </section></div> : null}
    </> : null}
  </main>
}
