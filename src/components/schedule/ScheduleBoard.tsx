'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { calendarDateKey, formatOperationalTime, operationalCalendarDate, operationalDateKey, operationalDateTimeInput, operationalInputToUtc } from '../../lib/operational-time'
import ScheduleHealthPanel from './ScheduleHealthPanel'
import DateTimeField12h from '../ui/DateTimeField12h'
import DurationField from '../ui/DurationField'
import TeamPicker from './TeamPicker'
import { formatDuration } from '../../lib/duration'
import './ScheduleFocus.css'

type Plan = { id: string; name: string; status: string; expectedDurationMinutes: number; site: { name: string; client: { displayName: string } } }
type Member = { id: string; name: string | null; email: string; role: string }
type Visit = { id: string; scheduledStart: string; scheduledEnd: string; status: string; version: number; requiredWorkers: number; dispatchNotes?: string | null; cancellationReason?: string | null; site: { name: string; city: string; client: { displayName: string } }; job: { name: string }; assignments: Array<{ status: string; user: Member }> }
type Availability = { id: string; startsAt: string; endsAt: string; reason?: string | null; user: Member }
type ScheduleView = 'month' | 'week' | 'day' | 'list'
type HealthFocus = 'scheduling' | 'conflicts' | 'confirmation' | null
type AssignmentState = { kind: 'busy' | 'unavailable'; label: string; visitId?: string; clientName?: string; siteName?: string; startsAt?: string; endsAt?: string; overlapMinutes?: number }

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Request failed')
  return body.data as T
}

function startOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1) }
function sameDay(instant: Date, calendarDate: Date, timezone = 'Europe/Dublin') { return operationalDateKey(instant, timezone) === calendarDateKey(calendarDate) }
function initials(member: Member) { return (member.name ?? member.email).split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase() }
function visitLabel(visit: Visit) { return `${visit.site.client.displayName} · ${visit.job.name}` }
function timeRange(start: Date, end: Date, timezone = 'Europe/Dublin') { return `${formatOperationalTime(start, timezone)}–${formatOperationalTime(end, timezone)}` }
const ACTIVE_ASSIGNMENT_STATUSES = new Set(['assigned', 'notified', 'seen', 'acknowledged'])
function isActiveAssignment(status: string) { return ACTIVE_ASSIGNMENT_STATUSES.has(status) }
function isTerminalVisit(status: string) { return status === 'cancelled' || status === 'missed' }

export default function ScheduleBoard({ canManage, timezone }: { canManage: boolean; timezone: string }) {
  const [visits, setVisits] = useState<Visit[]>([]); const [plans, setPlans] = useState<Plan[]>([]); const [team, setTeam] = useState<Member[]>([]); const [availability, setAvailability] = useState<Availability[]>([])
  const [view, setView] = useState<ScheduleView>('week'); const [anchorDate, setAnchorDate] = useState(() => operationalCalendarDate(new Date(), timezone)); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false)
  const [statusFilter, setStatusFilter] = useState('needs_scheduling'); const [healthFocus, setHealthFocus] = useState<HealthFocus>(null); const [healthReset, setHealthReset] = useState(0); const [teamFilter, setTeamFilter] = useState('all'); const [draftTeamFilter, setDraftTeamFilter] = useState('all'); const [teamQuery, setTeamQuery] = useState(''); const [notice, setNotice] = useState<string | null>(null); const [showCreate, setShowCreate] = useState(false); const [showFindTime, setShowFindTime] = useState(false); const [showFilters, setShowFilters] = useState(false); const [healthCloseSignal, setHealthCloseSignal] = useState(0)
  const [showPlanPicker, setShowPlanPicker] = useState(false); const [planQuery, setPlanQuery] = useState(''); const planPickerRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Visit | null>(null); const [edit, setEdit] = useState({ scheduledStart: '', scheduledEnd: '', assigneeIds: [] as string[], dispatchNotes: '', cancellationReason: '' })
  const [draft, setDraft] = useState({ servicePlanId: '', name: '', startAt: operationalDateTimeInput(new Date(Date.now() + 86_400_000), timezone), endDate: '', durationMinutes: 120, frequency: 'once', interval: 1, weekdays: [1, 3, 5] as number[], assigneeIds: [] as string[] })
  const [finder, setFinder] = useState({ date: operationalDateKey(new Date(Date.now() + 86_400_000), timezone), durationMinutes: 120, assigneeIds: [] as string[] })
  const range = useMemo(() => { const start = startOfMonth(anchorDate); start.setDate(start.getDate() - 7); const end = new Date(start); end.setMonth(end.getMonth() + 3); return { from: operationalInputToUtc(`${calendarDateKey(start)}T00:00`, timezone).toISOString(), to: operationalInputToUtc(`${calendarDateKey(end)}T23:59`, timezone).toISOString() } }, [anchorDate, timezone])
  const refresh = useCallback(async () => { setLoading(true); try { const [v, p, t, a] = await Promise.all([api<Visit[]>(`/api/visits?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&mode=all`), api<Plan[]>('/api/service-plans'), api<Member[]>('/api/team'), api<Availability[]>(`/api/availability?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`)]); setVisits(v); setPlans(p.filter((plan) => plan.status === 'published')); setTeam(t); setAvailability(a); setDraft((current) => ({ ...current, servicePlanId: current.servicePlanId || p.find((plan) => plan.status === 'published')?.id || '' })) } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not load schedule.') } finally { setLoading(false) } }, [range])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.querySelector('.filter-dialog-backdrop')) return
      if (showPlanPicker) { event.preventDefault(); event.stopPropagation(); setShowPlanPicker(false); setPlanQuery(''); return }
      if (selected) { event.preventDefault(); event.stopPropagation(); dismissSelected(); return }
      if (showCreate) { event.preventDefault(); event.stopPropagation(); setShowCreate(false); return }
      if (showFindTime) { event.preventDefault(); event.stopPropagation(); setShowFindTime(false); return }
      if (showFilters) {
        event.preventDefault()
        event.stopPropagation()
        setDraftTeamFilter(teamFilter)
        setTeamQuery('')
        setShowFilters(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selected, showFilters, showFindTime, showCreate, showPlanPicker, teamFilter])
  useEffect(() => {
    if (!showPlanPicker) return
    const onPointerDown = (event: MouseEvent) => {
      if (planPickerRef.current?.contains(event.target as Node)) return
      setShowPlanPicker(false)
      setPlanQuery('')
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [showPlanPicker])
  useEffect(() => {
    if (showCreate) return
    setShowPlanPicker(false)
    setPlanQuery('')
  }, [showCreate])
  useEffect(() => {
    const closeForHealth = () => {
      setShowFindTime(false)
      setShowFilters(false)
      window.dispatchEvent(new Event('diamond:close-nav'))
      requestAnimationFrame(() => {
        const active = document.querySelector<HTMLButtonElement>('.schedule-health-panel button[data-active="true"]')
        const label = active?.textContent?.toLowerCase() ?? ''
        if (label.includes('needs scheduling')) { setHealthFocus('scheduling'); setStatusFilter('upcoming') }
        else if (label.includes('conflicts')) { setHealthFocus('conflicts'); setStatusFilter('upcoming') }
        else if (label.includes('awaiting confirmation')) { setHealthFocus('confirmation'); setStatusFilter('upcoming') }
      })
    }
    window.addEventListener('diamond:schedule-health-open', closeForHealth)
    return () => window.removeEventListener('diamond:schedule-health-open', closeForHealth)
  }, [])
  useEffect(() => { const visitId = new URLSearchParams(window.location.search).get('visit'); if (!visitId || selected?.id === visitId) return; const visit = visits.find((item) => item.id === visitId); if (!visit) return; setSelected(visit); setEdit({ scheduledStart: operationalDateTimeInput(new Date(visit.scheduledStart), timezone), scheduledEnd: operationalDateTimeInput(new Date(visit.scheduledEnd), timezone), assigneeIds: visit.assignments.filter((assignment) => isActiveAssignment(assignment.status)).map((assignment) => assignment.user.id), dispatchNotes: visit.dispatchNotes ?? '', cancellationReason: visit.cancellationReason ?? '' }) }, [selected?.id, timezone, visits])
  useEffect(() => {
    if (!showCreate && !selected && !showFindTime && !showFilters) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [selected, showCreate, showFilters, showFindTime])

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
  const visitsInVisibleRange = useMemo(() => visits.filter((visit) => { const start = new Date(visit.scheduledStart); return start >= visibleWindow.from && start < visibleWindow.to }), [visibleWindow, visits])
  const visitHasConflict = useCallback((visit: Visit) => {
    if (['cancelled', 'completed', 'missed'].includes(visit.status)) return false
    const assignedIds = new Set(visit.assignments.filter((assignment) => isActiveAssignment(assignment.status)).map((assignment) => assignment.user.id))
    if (!assignedIds.size) return false
    const start = new Date(visit.scheduledStart)
    const end = new Date(visit.scheduledEnd)
    return visits.some((other) => other.id !== visit.id && !['cancelled', 'completed', 'missed'].includes(other.status) && new Date(other.scheduledStart) < end && new Date(other.scheduledEnd) > start && other.assignments.some((assignment) => assignedIds.has(assignment.user.id) && isActiveAssignment(assignment.status)))
  }, [visits])
  const visibleVisits = useMemo(() => visitsInVisibleRange.filter((visit) => {
    const activeAssignments = visit.assignments.filter((assignment) => isActiveAssignment(assignment.status))
    const activeCount = activeAssignments.length
    const historical = ['completed', 'cancelled', 'missed'].includes(visit.status)
    const statusMatch = healthFocus ? !historical : statusFilter === 'needs_scheduling' ? !historical && activeCount < visit.requiredWorkers : statusFilter === 'upcoming' ? !historical : statusFilter === 'history' ? historical : visit.status === statusFilter
    const healthMatch = healthFocus === 'scheduling' ? activeCount < visit.requiredWorkers : healthFocus === 'conflicts' ? visitHasConflict(visit) : healthFocus === 'confirmation' ? activeAssignments.some((assignment) => assignment.status !== 'acknowledged') : true
    const teamMatch = teamFilter === 'all' || (teamFilter === 'unassigned' ? activeCount === 0 : visit.assignments.some((assignment) => assignment.user.id === teamFilter && isActiveAssignment(assignment.status)))
    return statusMatch && healthMatch && teamMatch
  }), [healthFocus, statusFilter, teamFilter, visitHasConflict, visitsInVisibleRange])
  const grouped = useMemo(() => visibleVisits.reduce<Record<string, Visit[]>>((acc, visit) => { const key = new Date(visit.scheduledStart).toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'short', timeZone: timezone }); (acc[key] ??= []).push(visit); return acc }, {}), [timezone, visibleVisits])
  const monthDays = useMemo(() => { const first = startOfMonth(anchorDate); const gridStart = new Date(first); gridStart.setDate(first.getDate() - first.getDay()); return Array.from({ length: 42 }, (_, index) => { const date = new Date(gridStart); date.setDate(gridStart.getDate() + index); return date }) }, [anchorDate])
  const weekDays = useMemo(() => { const start = new Date(anchorDate); start.setDate(anchorDate.getDate() - anchorDate.getDay()); return Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date }) }, [anchorDate])
  const title = view === 'month' ? anchorDate.toLocaleDateString('en-IE', { month: 'long', year: 'numeric' }) : view === 'week' ? `${weekDays[0].toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })} – ${weekDays[6].toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })}` : anchorDate.toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const suggestedTimes = useMemo(() => {
    const candidateTeam = finder.assigneeIds.length ? finder.assigneeIds : team.map((member) => member.id)
    return [7, 9, 11, 13, 15, 17].map((hour) => {
      const start = operationalInputToUtc(`${finder.date}T${String(hour).padStart(2, '0')}:00`, timezone)
      const end = new Date(start.getTime() + finder.durationMinutes * 60_000)
      const unavailable = candidateTeam.filter((userId) => availability.some((entry) => entry.user.id === userId && new Date(entry.startsAt) < end && new Date(entry.endsAt) > start))
      const booked = visits.filter((visit) => !['cancelled', 'missed'].includes(visit.status) && new Date(visit.scheduledStart) < end && new Date(visit.scheduledEnd) > start && visit.assignments.some((assignment) => candidateTeam.includes(assignment.user.id) && isActiveAssignment(assignment.status)))
      return { start, end, free: Math.max(0, candidateTeam.length - new Set([...unavailable, ...booked.flatMap((visit) => visit.assignments.filter((assignment) => candidateTeam.includes(assignment.user.id) && isActiveAssignment(assignment.status)).map((assignment) => assignment.user.id))]).size), conflicts: unavailable.length + booked.length }
    })
  }, [availability, finder, team, timezone, visits])
  const assignmentState = useCallback((userId: string, startValue: string, endValue: string, ignoredVisitId?: string): AssignmentState | null => {
    const start = operationalInputToUtc(startValue, timezone); const end = operationalInputToUtc(endValue, timezone)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null
    const unavailable = availability.find((entry) => entry.user.id === userId && new Date(entry.startsAt) < end && new Date(entry.endsAt) > start)
    if (unavailable) return { kind: 'unavailable', label: `Unavailable · ${timeRange(new Date(unavailable.startsAt), new Date(unavailable.endsAt), timezone)}` }
    const visit = visits.find((item) => item.id !== ignoredVisitId && !['cancelled', 'completed', 'missed'].includes(item.status) && new Date(item.scheduledStart) < end && new Date(item.scheduledEnd) > start && item.assignments.some((assignment) => assignment.user.id === userId && isActiveAssignment(assignment.status)))
    if (!visit) return null
    const visitStart = new Date(visit.scheduledStart)
    const visitEnd = new Date(visit.scheduledEnd)
    const overlapMinutes = Math.max(1, Math.round((Math.min(end.getTime(), visitEnd.getTime()) - Math.max(start.getTime(), visitStart.getTime())) / 60_000))
    return {
      kind: 'busy',
      label: `Busy · ${timeRange(visitStart, visitEnd, timezone)} at ${visit.site.client.displayName} · ${visit.site.name}`,
      visitId: visit.id,
      clientName: visit.site.client.displayName,
      siteName: visit.site.name,
      startsAt: visit.scheduledStart,
      endsAt: visit.scheduledEnd,
      overlapMinutes,
    }
  }, [availability, timezone, visits])
  const editStates = useMemo(() => new Map(team.map((member) => [member.id, assignmentState(member.id, edit.scheduledStart, edit.scheduledEnd, selected?.id)])), [assignmentState, edit.scheduledStart, edit.scheduledEnd, selected?.id, team])
  const editConflicts = useMemo(() => edit.assigneeIds.flatMap((userId) => {
    const state = editStates.get(userId)
    if (!state || state.kind !== 'busy') return []
    const member = team.find((candidate) => candidate.id === userId)
    return [{ userId, name: member?.name ?? member?.email ?? 'Cleaner', state }]
  }), [edit.assigneeIds, editStates, team])
  const filteredTeamChoices = useMemo(() => { const needle = teamQuery.trim().toLowerCase(); return needle ? team.filter((member) => `${member.name ?? ''} ${member.email}`.toLowerCase().includes(needle)) : team }, [team, teamQuery])
  const selectedPlan = useMemo(() => plans.find((plan) => plan.id === draft.servicePlanId), [draft.servicePlanId, plans])
  const filteredPlans = useMemo(() => { const needle = planQuery.trim().toLowerCase(); return needle ? plans.filter((plan) => `${plan.site.client.displayName} ${plan.site.name} ${plan.name}`.toLowerCase().includes(needle)) : plans }, [planQuery, plans])

  function closeHealth() { setHealthCloseSignal((value) => value + 1) }
  function clearHealthFocus(nextStatus: string) { setHealthFocus(null); setHealthReset((value) => value + 1); setStatusFilter(nextStatus) }
  function dismissSelected() {
    setSelected(null)
    const url = new URL(window.location.href)
    if (!url.searchParams.has('visit')) return
    url.searchParams.delete('visit')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  function prepareMajorSurface() { closeHealth(); setShowFindTime(false); setShowFilters(false); window.dispatchEvent(new Event('diamond:close-nav')) }
  function movePeriod(direction: number) { const next = new Date(anchorDate); if (view === 'month') next.setMonth(next.getMonth() + direction); else if (view === 'week') next.setDate(next.getDate() + 7 * direction); else next.setDate(next.getDate() + direction); setAnchorDate(next) }
  function dismissFilters() { setDraftTeamFilter(teamFilter); setTeamQuery(''); setShowFilters(false) }
  function toggleFilters() { closeHealth(); window.dispatchEvent(new Event('diamond:close-nav')); setShowFindTime(false); if (showFilters) dismissFilters(); else { setDraftTeamFilter(teamFilter); setTeamQuery(''); setShowFilters(true) } }
  function applyFilters() { setTeamFilter(draftTeamFilter); setTeamQuery(''); setShowFilters(false) }
  function openCreateFor(date: Date) { prepareMajorSurface(); setDraft((current) => ({ ...current, startAt: `${calendarDateKey(date)}T09:00` })); setAnchorDate(date); setShowCreate(true) }
  async function createJob(event: FormEvent) { event.preventDefault(); setBusy(true); try { const recurrence = draft.frequency === 'weekly' ? { frequency: 'weekly', interval: draft.interval, weekdays: draft.weekdays } : draft.frequency === 'daily' ? { frequency: 'daily', interval: draft.interval } : { frequency: 'once' }; const result = await api<{ generatedVisits: number }>('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ servicePlanId: draft.servicePlanId, name: draft.name, startAt: operationalInputToUtc(draft.startAt, timezone).toISOString(), endDate: draft.endDate ? operationalInputToUtc(`${draft.endDate}T23:59:59`, timezone).toISOString() : null, durationMinutes: draft.durationMinutes, recurrence, assigneeIds: draft.assigneeIds }) }); setNotice(draft.frequency === 'once' ? 'Visit scheduled.' : `${result.generatedVisits} visits generated for the initial horizon. Future service obligations will be maintained automatically.`); setShowCreate(false); await refresh() } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not schedule job.') } finally { setBusy(false) } }
  function selectVisit(visit: Visit) { prepareMajorSurface(); setSelected(visit); setEdit({ scheduledStart: operationalDateTimeInput(new Date(visit.scheduledStart), timezone), scheduledEnd: operationalDateTimeInput(new Date(visit.scheduledEnd), timezone), assigneeIds: visit.assignments.filter((assignment) => isActiveAssignment(assignment.status)).map((assignment) => assignment.user.id), dispatchNotes: visit.dispatchNotes ?? '', cancellationReason: visit.cancellationReason ?? '' }) }
  function openHealthVisit(visitId: string) {
    const visit = visits.find((item) => item.id === visitId)
    if (!visit) {
      setNotice('This visit is not available in the current schedule window. Refresh and try again.')
      return
    }
    selectVisit(visit)
  }
  async function saveVisit(status?: 'scheduled' | 'cancelled') { if (!selected) return; if (status === 'cancelled' && !edit.cancellationReason.trim()) { setNotice('Add a cancellation reason so operations and audit history explain why this visit was removed.'); return } if (isTerminalVisit(selected.status)) { setNotice('Historical visits are read-only in the operational schedule.'); return } const conflicted = status !== 'cancelled' ? edit.assigneeIds.filter((userId) => editStates.get(userId)) : []; if (conflicted.length) { setNotice(`This change overlaps with existing work or unavailability for ${conflicted.length} selected person${conflicted.length === 1 ? '' : 's'}.`); return } setBusy(true); try { await api(`/api/visits/${selected.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: selected.version, scheduledStart: operationalInputToUtc(edit.scheduledStart, timezone).toISOString(), scheduledEnd: operationalInputToUtc(edit.scheduledEnd, timezone).toISOString(), assigneeIds: edit.assigneeIds, dispatchNotes: edit.dispatchNotes || null, status, cancellationReason: status === 'cancelled' ? edit.cancellationReason.trim() : null }) }); setNotice(status === 'cancelled' ? 'Visit cancelled, removed from Operational, team notified and history retained.' : 'Visit updated and the assigned team has been notified.'); dismissSelected(); await refresh() } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not update this visit.') } finally { setBusy(false) } }
  const renderVisit = (visit: Visit, compact = false) => {
    const activeAssignments = visit.assignments.filter((assignment) => isActiveAssignment(assignment.status))
    const coverage = `${activeAssignments.length}/${visit.requiredWorkers}`
    const conflicted = visitHasConflict(visit)
    return <button type="button" className={`visit-card visit-card-button${compact ? ' compact' : ''}${activeAssignments.length < visit.requiredWorkers ? ' coverage-gap' : ''}${conflicted ? ' schedule-conflict' : ''}`} style={conflicted ? { borderColor: '#e5a0a6', background: '#fff5f5', boxShadow: 'inset 4px 0 0 #d54853, 0 5px 14px rgba(153,45,54,.06)' } : undefined} key={visit.id} data-status={visit.status} onClick={() => selectVisit(visit)}><time><span>{formatOperationalTime(visit.scheduledStart, timezone)}</span><span>→ {formatOperationalTime(visit.scheduledEnd, timezone)}</span></time><div><strong>{compact ? visit.site.client.displayName : visitLabel(visit)}</strong>{!compact ? <><div>{visit.site.name}</div><small>{visit.site.city} · {formatDuration(Math.round((new Date(visit.scheduledEnd).getTime() - new Date(visit.scheduledStart).getTime()) / 60000))} shift</small></> : <small className="visit-coverage">{formatDuration(Math.round((new Date(visit.scheduledEnd).getTime() - new Date(visit.scheduledStart).getTime()) / 60000))} shift · Team {coverage}</small>}</div>{!compact ? <div className="visit-team">{activeAssignments.length ? activeAssignments.map((assignment) => <span key={assignment.user.id} title={assignment.user.email}>{initials(assignment.user)}</span>) : <em>Unassigned</em>}<small className="visit-coverage">{coverage} covered</small></div> : null}</button>
  }

  return <main className="page-shell schedule-page">
    <header className="page-header schedule-hero"><div><span className="eyebrow">Dispatch control</span><h1>Schedule</h1><p className="muted">Assign work, see capacity and resolve exceptions without leaving the operating plan.</p></div>{canManage ? <button className="btn-primary" onClick={() => { prepareMajorSurface(); setShowCreate(true) }}>+ Create work</button> : null}</header>
    <section className="schedule-focus-tabs" aria-label="Schedule focus">
      <button className={!healthFocus && statusFilter === 'needs_scheduling' ? 'selected' : ''} onClick={() => clearHealthFocus('needs_scheduling')}>Needs scheduling {visitsInVisibleRange.filter((visit) => !['completed', 'cancelled', 'missed'].includes(visit.status) && visit.assignments.filter((assignment) => isActiveAssignment(assignment.status)).length < visit.requiredWorkers).length}</button>
      <button className={!healthFocus && statusFilter === 'upcoming' ? 'selected' : ''} onClick={() => clearHealthFocus('upcoming')}>Upcoming</button>
      <button className={!healthFocus && statusFilter === 'history' ? 'selected' : ''} onClick={() => clearHealthFocus('history')}>History</button>
    </section>
    <section className="scheduler-controls" aria-label="Schedule controls"><div className="scheduler-period"><button aria-label="Previous period" className="btn-secondary" onClick={() => movePeriod(-1)}>←</button><button aria-label="Next period" className="btn-secondary" onClick={() => movePeriod(1)}>→</button><button className="btn-secondary" onClick={() => setAnchorDate(operationalCalendarDate(new Date(), timezone))}>Today</button><strong>{title}</strong></div><div className="scheduler-filters">
      <div className="schedule-tool-anchor">{canManage ? <button aria-expanded={showFindTime} className={showFindTime ? 'btn-primary' : 'btn-secondary'} onClick={() => { closeHealth(); window.dispatchEvent(new Event('diamond:close-nav')); dismissFilters(); setShowFindTime((value) => !value) }}>Find a time</button> : null}
        {showFindTime ? <button type="button" className="schedule-layer-backdrop" aria-label="Close time finder" onClick={() => setShowFindTime(false)} /> : null}
        {showFindTime ? <section className="schedule-popover find-time" aria-label="Find a workable visit window"><header><div><span className="eyebrow">Capacity finder</span><h2>Find a workable time</h2></div><button className="text-button" onClick={() => setShowFindTime(false)}>Close</button></header><div className="find-time-controls compact"><label>Date<input type="date" value={finder.date} onChange={(event) => setFinder({ ...finder, date: event.target.value })} /></label><DurationField value={finder.durationMinutes} onChange={(durationMinutes) => setFinder({ ...finder, durationMinutes })} /></div><TeamPicker members={team} selectedIds={finder.assigneeIds} onChange={(assigneeIds) => setFinder({ ...finder, assigneeIds })} label="Check availability for" helper="Leave empty to check all assignable staff." /><div className="find-time-slots compact">{suggestedTimes.map((slot) => <button key={slot.start.toISOString()} className={slot.conflicts ? 'has-conflict' : ''} onClick={() => { setDraft({ ...draft, startAt: operationalDateTimeInput(slot.start, timezone), durationMinutes: finder.durationMinutes, assigneeIds: finder.assigneeIds }); setAnchorDate(operationalCalendarDate(slot.start, timezone)); setView('day'); setShowFindTime(false); prepareMajorSurface(); setShowCreate(true) }}><b>{formatOperationalTime(slot.start, timezone)}–{formatOperationalTime(slot.end, timezone)}</b><span>{slot.free} available · {slot.conflicts ? `${slot.conflicts} conflict${slot.conflicts === 1 ? '' : 's'}` : 'clear window'}</span></button>)}</div></section> : null}
      </div>
      <div className="schedule-tool-anchor"><button className={showFilters ? 'btn-primary' : 'btn-secondary'} onClick={toggleFilters}>Filters{teamFilter !== 'all' ? ' · 1' : ''}</button>
        {showFilters ? <button type="button" className="schedule-layer-backdrop" aria-label="Discard filter changes" onClick={dismissFilters} /> : null}
        {showFilters ? <section className="schedule-popover schedule-filter-popover" role="dialog" aria-modal="true" aria-label="Schedule filters"><header><h2>Filters</h2><button className="text-button" onClick={dismissFilters}>Close</button></header><label>Team<input type="search" value={teamQuery} onChange={(event) => setTeamQuery(event.target.value)} placeholder="Search employee..." /></label><div className="schedule-filter-team"><button className={draftTeamFilter === 'all' ? 'selected' : ''} onClick={() => setDraftTeamFilter('all')}>All team</button><button className={draftTeamFilter === 'unassigned' ? 'selected' : ''} onClick={() => setDraftTeamFilter('unassigned')}>Unassigned only</button>{filteredTeamChoices.map((member) => <button key={member.id} className={draftTeamFilter === member.id ? 'selected' : ''} onClick={() => setDraftTeamFilter(member.id)}>{member.name ?? member.email}</button>)}</div><footer><button className="text-button" onClick={() => { setDraftTeamFilter('all'); setTeamQuery('') }}>Clear</button><button className="btn-primary" onClick={applyFilters}>Apply</button></footer></section> : null}
      </div>
      <div className="segmented-control schedule-view-tabs">{(['week', 'day', 'month', 'list'] as const).map((item) => <button key={item} className={view === item ? 'selected' : ''} onClick={() => setView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
    </div></section>
    {notice ? <div className="toast success" role="status">{notice}<button className="notice-close" onClick={() => setNotice(null)}>×</button></div> : null}
    {canManage ? <ScheduleHealthPanel key={healthReset} from={visibleWindow.from.toISOString()} to={visibleWindow.to.toISOString()} timezone={timezone} canManage={canManage} closeSignal={healthCloseSignal} onChanged={refresh} onOpenVisit={openHealthVisit} onOpenServicePlan={(servicePlanId) => { prepareMajorSurface(); setDraft((current) => ({ ...current, servicePlanId })); setShowCreate(true) }} /> : null}
    {showCreate ? <div className="modal-overlay active schedule-overlay" style={{ zIndex: 50 }} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false) }}><form className="schedule-create card schedule-sheet" onSubmit={createJob} role="dialog" aria-modal="true" aria-labelledby="recurring-job-title"><header><div><span className="eyebrow">Smart recurring schedule</span><h2 id="recurring-job-title">Schedule cleaning work</h2><p className="muted">Set the service obligation and default team once. The server maintains future occurrences; unavailable cleaners become staffing gaps, not missing work.</p></div><button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Close</button></header><div className="service-plan-field"><span className="service-plan-label">Service plan</span><div className={`service-plan-picker${showPlanPicker ? ' open' : ''}`} ref={planPickerRef}><button type="button" className="service-plan-trigger" aria-haspopup="listbox" aria-expanded={showPlanPicker} onClick={() => { setPlanQuery(''); setShowPlanPicker((value) => !value) }}><span>{selectedPlan ? `${selectedPlan.site.client.displayName} · ${selectedPlan.site.name} · ${selectedPlan.name}` : 'Search service plan...'}</span><span aria-hidden="true">⌄</span></button>{showPlanPicker ? <div className="service-plan-menu"><input autoFocus type="search" value={planQuery} onChange={(event) => setPlanQuery(event.target.value)} placeholder="Type client, site or plan..." aria-label="Search service plans" /><div className="service-plan-options" role="listbox" aria-label="Service plans">{filteredPlans.map((plan) => <button type="button" role="option" aria-selected={draft.servicePlanId === plan.id} className={draft.servicePlanId === plan.id ? 'selected' : ''} key={plan.id} onClick={() => { setDraft((current) => ({ ...current, servicePlanId: plan.id, durationMinutes: plan.expectedDurationMinutes })); setShowPlanPicker(false); setPlanQuery('') }}><strong>{plan.site.client.displayName} · {plan.site.name}</strong><span>{plan.name}</span></button>)}{!filteredPlans.length ? <p className="muted">No service plans found.</p> : null}</div></div> : null}</div></div><label>Job name<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Tuesday and Thursday office clean" /></label><div className="form-pair"><DateTimeField12h label="First visit" required value={draft.startAt} onChange={(value) => setDraft({ ...draft, startAt: value })} /><label>Service end (optional)<input type="date" min={draft.startAt.slice(0, 10)} value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></label></div><div className="form-pair"><label>Repeat<select value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: event.target.value })}><option value="once">Once only</option><option value="daily">Every day</option><option value="weekly">Selected weekdays</option></select></label>{draft.frequency !== 'once' ? <label>Every<input type="number" min="1" max={draft.frequency === 'weekly' ? 12 : 30} value={draft.interval} onChange={(event) => setDraft({ ...draft, interval: Math.max(1, Number(event.target.value)) })} /></label> : <DurationField value={draft.durationMinutes} onChange={(durationMinutes) => setDraft({ ...draft, durationMinutes })} />}</div>{draft.frequency === 'weekly' ? <fieldset className="weekday-picker"><legend>Repeat on</legend>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day, index) => <label key={day}><input type="checkbox" checked={draft.weekdays.includes(index)} onChange={() => setDraft((current) => ({ ...current, weekdays: current.weekdays.includes(index) ? current.weekdays.filter((value) => value !== index) : [...current.weekdays, index].sort() }))} />{day}</label>)}</fieldset> : null}<div className="schedule-team-field"><TeamPicker members={team} selectedIds={draft.assigneeIds} onChange={(assigneeIds) => setDraft((current) => ({ ...current, assigneeIds }))} label="Default cleaning team" helper="Used for each occurrence where the person is available." /></div><footer><span className="muted">{draft.frequency === 'weekly' ? `${draft.weekdays.length} day${draft.weekdays.length === 1 ? '' : 's'} per selected week` : draft.frequency === 'daily' ? `Every ${draft.interval} day${draft.interval === 1 ? '' : 's'}` : 'One visit'} · {draft.frequency === 'once' ? 'single occurrence' : draft.endDate ? `service ends ${new Date(`${draft.endDate}T12:00:00`).toLocaleDateString('en-IE')}` : 'ongoing service · future horizon maintained automatically'}</span><button className="btn-primary" disabled={busy || !plans.length || (draft.frequency === 'weekly' && !draft.weekdays.length)}>Generate schedule</button></footer></form></div> : null}
    {loading ? <section className="card empty-state">Loading schedule…</section> : null}
    {!loading && <>
      {view === 'month' ? <section className="month-calendar card"><div className="calendar-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{monthDays.map((date) => { const rows = visibleVisits.filter((visit) => sameDay(new Date(visit.scheduledStart), date, timezone)); return <button className={`calendar-cell${date.getMonth() !== anchorDate.getMonth() ? ' muted-month' : ''}${calendarDateKey(date) === operationalDateKey(new Date(), timezone) ? ' is-today' : ''}`} key={date.toISOString()} onClick={() => canManage ? openCreateFor(date) : (setAnchorDate(date), setView('day'))} aria-label={canManage ? `Create work on ${date.toLocaleDateString('en-IE')}` : undefined}><span className="calendar-date">{date.getDate()}</span>{rows.slice(0, 2).map((visit) => <span className={`calendar-visit ${visit.status}`} style={visitHasConflict(visit) ? { background: '#fff0f1', color: '#9f3038', borderColor: '#e3a0a5' } : undefined} key={visit.id}>{timeRange(new Date(visit.scheduledStart), new Date(visit.scheduledEnd), timezone)} {visit.site.client.displayName}</span>)}{rows.length > 2 ? <small>+{rows.length - 2} more</small> : null}</button> })}</div></section> : null}
      {view === 'week' ? <section className="week-calendar card">{weekDays.map((date) => { const rows = visibleVisits.filter((visit) => sameDay(new Date(visit.scheduledStart), date, timezone)); return <section className={`week-column${calendarDateKey(date) === operationalDateKey(new Date(), timezone) ? ' is-today' : ''}`} key={date.toISOString()}><header><b>{date.toLocaleDateString('en-IE', { weekday: 'short' })}</b><strong>{date.getDate()}</strong><span>{rows.length} visit{rows.length === 1 ? '' : 's'}</span></header><div>{rows.map((visit) => renderVisit(visit, true))}{canManage ? <button className="week-empty" onClick={() => openCreateFor(date)}>+ Schedule work</button> : !rows.length ? <span>No assigned work</span> : null}</div></section> })}</section> : null}
      {view === 'day' ? <section className="day-schedule card"><header><div><span className="eyebrow">{anchorDate.toLocaleDateString('en-IE', { weekday: 'long' })}</span><h2>{anchorDate.toLocaleDateString('en-IE', { day: 'numeric', month: 'long' })}</h2></div><div className="day-schedule-actions"><span>{visibleVisits.filter((visit) => sameDay(new Date(visit.scheduledStart), anchorDate, timezone)).length} visits</span>{canManage ? <button className="btn-secondary" onClick={() => openCreateFor(anchorDate)}>+ Schedule work</button> : null}</div></header>{visibleVisits.filter((visit) => sameDay(new Date(visit.scheduledStart), anchorDate, timezone)).map((visit) => renderVisit(visit))}{!visibleVisits.some((visit) => sameDay(new Date(visit.scheduledStart), anchorDate, timezone)) ? <div className="empty-state">{healthFocus === 'conflicts' ? 'No conflicts for this day.' : healthFocus === 'confirmation' ? 'No visits awaiting confirmation for this day.' : statusFilter === 'needs_scheduling' || healthFocus === 'scheduling' ? 'No scheduling gaps for this day.' : statusFilter === 'history' ? 'No history for this day.' : 'No upcoming work for this day.'}{canManage ? <button className="btn-primary" onClick={() => openCreateFor(anchorDate)}>Schedule this day</button> : null}</div> : null}</section> : null}
      {view === 'list' ? <section className="schedule-board list"><aside className="schedule-summary"><strong>{visibleVisits.length}</strong><span>visits in range</span><div><b>{visibleVisits.filter((visit) => visit.status === 'completed').length}</b> complete</div><div><b>{visibleVisits.filter((visit) => !visit.assignments.some((assignment) => isActiveAssignment(assignment.status))).length}</b> unassigned</div></aside><div className="schedule-days">{Object.entries(grouped).map(([day, rows]) => <section className="schedule-day" key={day}><header><h2>{day}</h2><span>{rows.length} visit{rows.length === 1 ? '' : 's'}</span></header>{rows.map((visit) => renderVisit(visit))}</section>)}{!visibleVisits.length ? <div className="card empty-state">{healthFocus === 'conflicts' ? 'No conflicts in this period.' : healthFocus === 'confirmation' ? 'No visits awaiting confirmation in this period.' : statusFilter === 'needs_scheduling' || healthFocus === 'scheduling' ? 'No scheduling gaps in this period.' : statusFilter === 'history' ? 'No history in this period.' : 'No upcoming work in this period.'}</div> : null}</div></section> : null}
      {selected && canManage ? <div className="modal-overlay active schedule-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dismissSelected() }}><section className="schedule-edit card schedule-sheet schedule-edit-sheet" role="dialog" aria-modal="true" aria-labelledby="edit-visit-title"><header><div><span className="eyebrow">Dispatch action</span><h2 id="edit-visit-title">{selected.site.client.displayName} · {selected.site.name}</h2><p className="muted">Update this occurrence only. The change is auditable and the team sees the latest dispatch instruction.</p></div><button className="btn-secondary" onClick={() => dismissSelected()}>Close</button></header>{editConflicts.length ? <div role="alert" style={{ gridColumn: '1 / -1', display: 'grid', gap: 9, padding: '12px 14px', border: '1px solid #efb4b4', borderRadius: 14, background: '#fff4f4' }}><div><strong style={{ display: 'block', color: '#8f2424', fontSize: 14 }}>Schedule conflict</strong><span style={{ display: 'block', marginTop: 3, color: '#6f3b3b', fontSize: 12 }}>{editConflicts.length === 1 ? 'One cleaner is double-booked during this visit.' : `${editConflicts.length} cleaners are double-booked during this visit.`}</span></div>{editConflicts.map(({ userId, name, state }) => <div key={userId} style={{ display: 'grid', gap: 2, paddingTop: 8, borderTop: '1px solid #f3cccc' }}><strong style={{ color: '#8f2424' }}>{name} · CONFLICT</strong><span style={{ fontSize: 12, fontWeight: 750 }}>Also working at {state.clientName} · {state.siteName}</span><span style={{ color: '#7c4a4a', fontSize: 11 }}>{state.startsAt && state.endsAt ? `${timeRange(new Date(state.startsAt), new Date(state.endsAt), timezone)} · ` : ''}{state.overlapMinutes ?? 0} min overlap</span></div>)}</div> : null}<DateTimeField12h label="Start" value={edit.scheduledStart} onChange={(value) => setEdit({ ...edit, scheduledStart: value })} /><DateTimeField12h label="End" value={edit.scheduledEnd} onChange={(value) => setEdit({ ...edit, scheduledEnd: value })} /><div className="schedule-team-field"><TeamPicker members={team} selectedIds={edit.assigneeIds} onChange={(assigneeIds) => setEdit((current) => ({ ...current, assigneeIds }))} label="Assigned cleaning team" helper={`${edit.assigneeIds.length}/${selected.requiredWorkers} currently covered${editConflicts.length ? ` · ${editConflicts.length} conflict${editConflicts.length === 1 ? '' : 's'}` : ''}`} /></div><label className="schedule-full-field">Dispatch note<textarea value={edit.dispatchNotes} onChange={(event) => setEdit({ ...edit, dispatchNotes: event.target.value })} placeholder="Only what the assigned team needs to know" /></label><label className="schedule-full-field">Cancellation reason<input value={edit.cancellationReason} onChange={(event) => setEdit({ ...edit, cancellationReason: event.target.value })} placeholder="Required before cancellation" /></label><div className="schedule-edit-actions"><button className="btn-danger" disabled={busy || selected.status === 'completed' || isTerminalVisit(selected.status) || !edit.cancellationReason.trim()} onClick={() => void saveVisit('cancelled')}>Cancel visit</button><button className="btn-primary" disabled={busy || selected.status === 'completed' || isTerminalVisit(selected.status)} onClick={() => void saveVisit('scheduled')}>Save occurrence</button></div></section></div> : null}</>}
  </main>
}