'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addOperationalDays, formatOperationalTime, operationalDateKey } from '../../lib/operational-time'
import type { ScheduleHealthItem, ScheduleHealthState } from '../../modules/scheduling/schedule-health-core'
import StandardSelect from '../ui/StandardSelect'
import styles from './ScheduleHealthPanel.module.css'
import './ScheduleHealthCards.css'
import { formatDuration } from '../../lib/duration'

type Summary = {
  visits: number
  covered: number
  needsStaff: number
  unassigned: number
  missingSchedule: number
  unscheduledServices: number
  paused: number
  conflicts: number
  unacknowledged: number
}
type Result = { from: string; to: string; summary: Summary; items: ScheduleHealthItem[] }
type Filter = 'all' | 'problems' | 'covered' | 'scheduling' | 'paused' | 'conflicts' | 'confirmation'
type PauseDraft = { scope: 'client' | 'site' | 'job'; targetId: string; fromDate: string; untilDate: string; reason: string; note: string }
type PausePreview = { target: string; timezone: string; consequence: { canApply: boolean; affectedVisits: number; materializedVisits: number; expectedOccurrences: number; assignedCleaners: number; plannedLabourHours: number; blockers: Array<{ id: string; site: string }> } }
type EnsureResult = { result: { jobsChecked: number; generatedVisits: number; pausedOccurrences: number; staffingGaps: number } }
type ReminderResult = { visitId: string; reminded: number; notificationJobId: string }

const PROBLEM_STATES = new Set<ScheduleHealthState>(['needs_staff', 'unassigned', 'expected_not_scheduled', 'unscheduled_service', 'cleaner_overlap', 'acknowledgement_pending'])
const SCHEDULING_STATES = new Set<ScheduleHealthState>(['needs_staff', 'unassigned', 'expected_not_scheduled', 'unscheduled_service'])
const labels: Record<ScheduleHealthState, string> = {
  covered: 'Covered',
  needs_staff: 'Team needed',
  unassigned: 'Team needed',
  expected_not_scheduled: 'Visit not created',
  unscheduled_service: 'Service setup needed',
  service_paused: 'Service paused',
  cleaner_overlap: 'Double booked',
  acknowledgement_pending: 'Awaiting confirmation',
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) throw new Error(body?.error ?? 'Request failed')
  return body.data as T
}

export default function ScheduleHealthPanel({
  from, to, timezone, canManage, closeSignal, refreshSignal, teamScope, focus, attentionView, attentionVisitCount, onChanged, onFocusChange, onOpenVisit, onOpenServicePlan,
}: {
  from: string
  to: string
  timezone: string
  canManage: boolean
  closeSignal: number
  refreshSignal: number
  teamScope: string
  focus: 'scheduling' | 'conflicts' | 'confirmation' | null
  attentionView: boolean
  attentionVisitCount: number
  onChanged: () => Promise<void> | void
  onFocusChange: (focus: 'scheduling' | 'conflicts' | 'confirmation' | null) => void
  onOpenVisit: (visitId: string) => void
  onOpenServicePlan: (servicePlanId: string) => void
}) {
  const requestKey = `${from}|${to}|${teamScope}|${refreshSignal}`
  const [response, setResponse] = useState<{ key: string; data: Result } | null>(null)
  const data = response?.key === requestKey ? response.data : null
  const filter: Filter = focus ?? 'problems'
  const requestRef = useRef<AbortController | null>(null)
  const contextRef = useRef(requestKey)
  contextRef.current = requestKey
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pauseItem, setPauseItem] = useState<ScheduleHealthItem | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerQuery, setDrawerQuery] = useState('')
  const [drawerDate, setDrawerDate] = useState('all')
  const [pauseDraft, setPauseDraft] = useState<PauseDraft | null>(null)
  const [preview, setPreview] = useState<PausePreview | null>(null)
  const drawerRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const refresh = useCallback(async () => {
    if (contextRef.current !== requestKey) return
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true); setError('')
    const query = new URLSearchParams({ from, to })
    if (teamScope === 'unassigned') query.set('unassigned', 'true')
    else if (teamScope !== 'all') query.set('employeeId', teamScope)
    try {
      const result = await api<Result>(`/api/schedule-health?${query}`, { signal: controller.signal })
      if (!controller.signal.aborted && contextRef.current === requestKey) setResponse({ key: requestKey, data: result })
    }
    catch (cause) { if (!controller.signal.aborted) { setResponse(null); setError(cause instanceof Error ? cause.message : 'Could not load schedule health.') } }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }, [from, to, teamScope, requestKey])
  useEffect(() => { void refresh(); return () => requestRef.current?.abort() }, [refresh])
  useEffect(() => { setDrawerOpen(false) }, [closeSignal])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && drawerOpen && !pauseItem && drawerRef.current) {
        const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        if (focusable.length) {
          const first = focusable[0]; const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
      }
      if (event.key !== 'Escape') return
      if (pauseItem) { event.preventDefault(); event.stopPropagation(); setPauseItem(null); setPauseDraft(null); setPreview(null); return }
      if (drawerOpen) { event.preventDefault(); event.stopPropagation(); setDrawerOpen(false) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [drawerOpen, pauseItem])
  useEffect(() => {
    if (!drawerOpen) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => drawerRef.current?.focus())
    return () => { document.body.style.overflow = previousOverflow; requestAnimationFrame(() => returnFocusRef.current?.focus()) }
  }, [drawerOpen])

  const visible = useMemo(() => (data?.items ?? []).filter((item) => {
    if (filter === 'problems') return PROBLEM_STATES.has(item.state)
    if (filter === 'scheduling') return SCHEDULING_STATES.has(item.state)
    if (filter === 'conflicts') return item.state === 'cleaner_overlap'
    return item.state === 'acknowledgement_pending'
  }), [data?.items, filter])
  const drawerDates = useMemo(() => [...new Set(visible.flatMap((item) => item.scheduledStart ? [operationalDateKey(new Date(item.scheduledStart), item.timezone ?? timezone)] : []))].sort(), [timezone, visible])
  const displayedItems = useMemo(() => {
    const needle = drawerQuery.trim().toLowerCase()
    return visible.filter((item) => {
      const matchesQuery = !needle || `${item.clientName} ${item.siteName ?? ''} ${item.jobName ?? ''} ${item.servicePlanName ?? ''} ${item.conflict?.workerName ?? ''} ${item.conflict?.otherClientName ?? ''} ${item.conflict?.otherSiteName ?? ''}`.toLowerCase().includes(needle)
      const itemDate = item.scheduledStart ? operationalDateKey(new Date(item.scheduledStart), item.timezone ?? timezone) : ''
      return matchesQuery && (drawerDate === 'all' || itemDate === drawerDate)
    })
  }, [drawerDate, drawerQuery, timezone, visible])

  function openPause(item: ScheduleHealthItem) {
    const start = item.scheduledStart ? new Date(item.scheduledStart) : new Date()
    const startKey = operationalDateKey(start, item.timezone ?? timezone)
    const scope: PauseDraft['scope'] = item.jobId ? 'job' : item.siteId ? 'site' : 'client'
    const targetId = scope === 'job' ? item.jobId! : scope === 'site' ? item.siteId! : item.clientId!
    setPauseItem(item)
    setPauseDraft({ scope, targetId, fromDate: startKey, untilDate: addOperationalDays(startKey, 7), reason: 'Client requested service pause', note: '' })
    setPreview(null); setError('')
  }

  function changeScope(scope: PauseDraft['scope']) {
    if (!pauseDraft || !pauseItem) return
    const targetId = scope === 'job' ? pauseItem.jobId : scope === 'site' ? pauseItem.siteId : pauseItem.clientId
    if (!targetId) return
    setPauseDraft({ ...pauseDraft, scope, targetId }); setPreview(null)
  }

  async function previewPause() {
    if (!pauseDraft) return
    setBusy(true); setError('')
    try {
      setPreview(await api<PausePreview>('/api/service-pauses?preview=true', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pauseDraft),
      }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not preview this pause.') }
    finally { setBusy(false) }
  }

  async function confirmPause() {
    if (!pauseDraft || !preview?.consequence.canApply) return
    setBusy(true); setError('')
    try {
      await api('/api/service-pauses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pauseDraft) })
      setPauseItem(null); setPauseDraft(null); setPreview(null)
      await Promise.resolve(onChanged()); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply this pause.') }
    finally { setBusy(false) }
  }

  async function ensureOccurrence(item: ScheduleHealthItem) {
    if (!item.jobId || !item.scheduledStart || !item.scheduledEnd) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await api<EnsureResult>('/api/schedule-health', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: item.scheduledStart, to: new Date(new Date(item.scheduledEnd).getTime() + 60_000).toISOString(), jobIds: [item.jobId] }),
      })
      setMessage(result.result.generatedVisits > 0
        ? `Visit created${result.result.staffingGaps ? ' with a staffing gap to resolve.' : ' successfully.'}`
        : 'Schedule continuity checked. No additional visit was required.')
      await Promise.resolve(onChanged()); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not generate this expected visit.') }
    finally { setBusy(false) }
  }

  async function endPause(item: ScheduleHealthItem) {
    if (!item.pauseId || item.pauseVersion == null) return
    setBusy(true); setError('')
    try {
      const result = await api<{ affectedFutureVisits: number; message: string }>(`/api/service-pauses/${item.pauseId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: item.pauseVersion }),
      })
      setMessage(result.message)
      await Promise.resolve(onChanged()); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not end this pause.') }
    finally { setBusy(false) }
  }

  async function remindAcknowledgement(item: ScheduleHealthItem) {
    if (!item.visitId) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await api<ReminderResult>(`/api/visits/${item.visitId}/remind`, { method: 'POST' })
      setMessage(`Reminder queued for ${result.reminded} cleaner${result.reminded === 1 ? '' : 's'}.`)
      await Promise.resolve(onChanged()); await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send acknowledgement reminder.') }
    finally { setBusy(false) }
  }

  const summary = data?.summary
  const affectedConflictVisits = new Set((data?.items ?? []).filter((item) => item.state === 'cleaner_overlap').flatMap((item) => [item.visitId, item.conflict?.otherVisitId].filter((id): id is string => Boolean(id)))).size
  const notOnCalendar = (data?.items ?? []).filter((item) => !item.visitId && SCHEDULING_STATES.has(item.state))
  const stats = summary ? [
    { label: 'Needs scheduling', value: summary.needsStaff + summary.unassigned + summary.missingSchedule + summary.unscheduledServices, filter: 'scheduling' as Filter },
    { label: 'Conflicts', value: summary.conflicts, filter: 'conflicts' as Filter },
    { label: 'Awaiting confirmation', value: summary.unacknowledged, filter: 'confirmation' as Filter },
  ] : []
  const drawerTitle = filter === 'scheduling' ? 'Needs scheduling' : filter === 'conflicts' ? 'Conflicts' : filter === 'confirmation' ? 'Awaiting confirmation' : 'Schedule issues'
  const activeStat = stats.find((stat) => stat.filter === filter)
  const healthFocus = (next: Filter) => next === 'scheduling' || next === 'conflicts' || next === 'confirmation' ? next : null

  const selectFilter = (next: Filter) => {
    setDrawerOpen(false)
    setDrawerQuery('')
    setDrawerDate('all')
    onFocusChange(healthFocus(next))
  }
  const openDetails = (next: Filter) => {
    setDrawerQuery('')
    setDrawerDate('all')
    setDrawerOpen(true)
    onFocusChange(healthFocus(next))
  }
  const clearFilter = () => {
    onFocusChange(null)
  }
  const openVisit = (visitId: string) => {
    setDrawerOpen(false)
    onOpenVisit(visitId)
  }

  return <section className={`${styles.panel} schedule-health-panel`} aria-label="Schedule intelligence and service continuity">
    {summary ? <div className={styles.healthBar}>{stats.map((stat) => <div key={stat.label} className="schedule-health-stat-wrap" data-health-filter={stat.filter}><button className={`${styles.stat} schedule-health-stat-main`} data-active={filter === stat.filter} aria-pressed={filter === stat.filter} onClick={() => selectFilter(stat.filter)}><strong>{stat.value}</strong><span>{stat.label}</span>{stat.filter === 'conflicts' ? <small className="schedule-health-stat-context">{affectedConflictVisits} visits affected</small> : stat.filter === 'confirmation' ? <small className="schedule-health-stat-context">Follow up before the visit starts</small> : null}</button><button type="button" className="schedule-health-stat-details" disabled={stat.value === 0} onClick={() => openDetails(stat.filter)}>View details <span aria-hidden="true">→</span></button></div>)}</div> : null}
    <div className={styles.filters}>{activeStat ? <div className="schedule-health-active-filter"><span>Showing: <strong>{activeStat.label}</strong> · {activeStat.value}{focus === 'conflicts' ? ` · ${affectedConflictVisits} visits affected` : ''}</span><button type="button" onClick={clearFilter}>Clear</button></div> : <span className={styles.filterHint}>{attentionView ? `${attentionVisitCount} visits need attention · each visit is counted once` : 'Health summary for the selected team and period.'}</span>}<button className={styles.sync} disabled={loading || busy} onClick={() => void refresh()}>{loading ? 'Checking…' : 'Refresh health'}</button></div>
    {attentionView && (!focus || focus === 'scheduling') && notOnCalendar.length > 0 ? <section className="schedule-pending-work" aria-label="Work not yet on calendar"><header><h2>Not yet on calendar · {notOnCalendar.length}</h2><p>These client services still need their schedule configured in Clients. Concrete visits stay separate below.</p></header>{notOnCalendar.map((item) => <article key={item.id}><div><strong>{item.clientName}{item.siteName ? ` · ${item.siteName}` : ''}</strong><p>{labels[item.state]} · {item.detail}</p>{item.scheduledStart ? <small>{new Date(item.scheduledStart).toLocaleString('en-IE', { timeZone: item.timezone ?? timezone })}</small> : <small>No date set</small>}</div>{item.state === 'expected_not_scheduled' && item.jobId ? <button type="button" className="btn-primary" disabled={busy} onClick={() => void ensureOccurrence(item)}>Create visit</button> : item.servicePlanId ? <button type="button" className="btn-primary" disabled={busy} onClick={() => onOpenServicePlan(item.servicePlanId!)}>Configure service</button> : null}</article>)}</section> : null}
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {message ? <div className="toast success" role="status">{message}<button className="notice-close" onClick={() => setMessage('')}>×</button></div> : null}
    {drawerOpen ? <button type="button" className="schedule-health-backdrop" aria-label="Close schedule health details" onClick={() => setDrawerOpen(false)} /> : null}
    <div ref={drawerRef} className={styles.list} data-open={drawerOpen} role={drawerOpen ? 'dialog' : undefined} aria-modal={drawerOpen ? true : undefined} aria-label={drawerOpen ? `${drawerTitle} details` : undefined} tabIndex={drawerOpen ? -1 : undefined}>
      {drawerOpen ? <div className="schedule-health-drawer-header"><div><span className="eyebrow">Needs attention</span><h2>{drawerTitle}</h2></div><button type="button" className="btn-secondary" onClick={() => setDrawerOpen(false)}>Close</button></div> : null}
      {drawerOpen ? <div className="schedule-health-drawer-tools"><label><span>Search</span><input type="search" value={drawerQuery} onChange={(event) => setDrawerQuery(event.target.value)} placeholder="Client, site or employee..." /></label><div style={{ display: 'grid', gap: 6 }}><span>Date</span><StandardSelect value={drawerDate} onChange={setDrawerDate} ariaLabel="Schedule health date" options={[{ value: 'all', label: 'All dates' }, ...drawerDates.map((date) => ({ value: date, label: new Date(`${date}T12:00:00`).toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short' }) }))]} /></div></div> : null}
      <div className="schedule-health-results">
      {!loading && !displayedItems.length ? <div className={styles.empty}>{visible.length ? 'No items match these filters.' : filter === 'problems' ? 'No operational scheduling problems in this window.' : 'No items match this health filter.'}</div> : null}
      {displayedItems.map((item) => {
        const start = item.scheduledStart ? new Date(item.scheduledStart) : null
        const zone = item.timezone ?? timezone
        const pauseable = canManage && item.jobId && item.state === 'covered'
        const otherZone = item.conflict?.otherTimezone ?? zone
        return <article key={item.id} className={styles.item} data-state={item.state}>
          <div className={styles.state}><span aria-hidden="true">{item.state === 'covered' ? '✓' : item.state === 'service_paused' ? '⏸' : item.state === 'cleaner_overlap' || item.state === 'expected_not_scheduled' ? '⛔' : '⚠'}</span>{labels[item.state]}</div>
          <div className={styles.copy}><strong>{item.clientName}{item.siteName ? ` · ${item.siteName}` : ''}</strong><span>{item.jobName ?? item.servicePlanName ?? 'Client service'}</span><small>{item.detail}</small>{item.conflict ? <div className={styles.conflictContext}><strong>{item.conflict.workerName}</strong><span>Also scheduled at {item.conflict.otherClientName} · {item.conflict.otherSiteName}</span><small>{formatOperationalTime(new Date(item.conflict.otherScheduledStart), otherZone)}–{formatOperationalTime(new Date(item.conflict.otherScheduledEnd), otherZone)} · {item.conflict.overlapMinutes} min overlap</small></div> : null}</div>
          <div className={styles.when}>{start ? <><strong>{start.toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone })}</strong><span>{formatOperationalTime(start, zone)}{item.scheduledEnd ? `–${formatOperationalTime(new Date(item.scheduledEnd), zone)}` : ''}{item.requiredWorkers ? ` · ${item.activeWorkers ?? 0}/${item.requiredWorkers}` : ''}</span></> : <span>Needs service configuration</span>}</div>
          <div className={styles.actions}>
            {canManage && item.state === 'expected_not_scheduled' && item.jobId && !item.visitId ? <button className="btn-primary" disabled={busy} onClick={() => void ensureOccurrence(item)}>Create visit</button> : null}
            {canManage && item.state === 'expected_not_scheduled' && item.visitId ? <button className="btn-secondary" disabled={busy} onClick={() => openVisit(item.visitId!)}>Review visit</button> : null}
            {canManage && item.state === 'unscheduled_service' && item.servicePlanId ? <button className="btn-primary" disabled={busy} onClick={() => onOpenServicePlan(item.servicePlanId!)}>Configure service</button> : null}
            {canManage && (item.state === 'needs_staff' || item.state === 'unassigned') && item.visitId ? <button className="btn-primary" disabled={busy} onClick={() => openVisit(item.visitId!)}>Assign team</button> : null}
            {canManage && item.state === 'cleaner_overlap' && item.visitId ? <button className="btn-primary" disabled={busy} onClick={() => openVisit(item.visitId!)}>Resolve conflict</button> : null}
            {canManage && item.state === 'acknowledgement_pending' && item.visitId ? <button className="btn-primary" disabled={busy} onClick={() => void remindAcknowledgement(item)}>{busy ? 'Sending…' : 'Remind pending visit team'}</button> : null}
            {canManage && item.state === 'acknowledgement_pending' && item.visitId ? <button className="btn-secondary" disabled={busy} onClick={() => openVisit(item.visitId!)}>Open visit</button> : null}
            {pauseable ? <button className="btn-secondary" disabled={busy} onClick={() => openPause(item)}>Pause service</button> : null}
            {canManage && item.state === 'service_paused' && item.pauseId ? <button className="btn-secondary" disabled={busy} onClick={() => void endPause(item)}>End pause early</button> : null}
          </div>
        </article>
      })}
      </div>
    </div>
    {pauseItem && pauseDraft ? <div className={styles.modalOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setPauseItem(null); setPauseDraft(null); setPreview(null) } }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="pause-service-title">
      <header><div><span className="eyebrow">Service continuity</span><h3 id="pause-service-title">Pause service</h3><p className="muted">See the operational consequence before cancelling future work.</p></div><button className="btn-secondary" onClick={() => { setPauseItem(null); setPauseDraft(null); setPreview(null) }}>Close</button></header>
      <div className={styles.formGrid}><div style={{ display: 'grid', gap: 6 }}><span>Scope</span><StandardSelect value={pauseDraft.scope} onChange={(value) => changeScope(value as PauseDraft['scope'])} ariaLabel="Pause scope" options={[...(pauseItem.jobId ? [{ value: 'job', label: 'This recurring service' }] : []), ...(pauseItem.siteId ? [{ value: 'site', label: 'This site' }] : []), ...(pauseItem.clientId ? [{ value: 'client', label: 'Entire client' }] : [])]} /></div><label>Reason<input value={pauseDraft.reason} onChange={(event) => { setPauseDraft({ ...pauseDraft, reason: event.target.value }); setPreview(null) }} /></label><label>From<input type="date" value={pauseDraft.fromDate} onChange={(event) => { setPauseDraft({ ...pauseDraft, fromDate: event.target.value }); setPreview(null) }} /></label><label>Until (inclusive)<input type="date" min={pauseDraft.fromDate} value={pauseDraft.untilDate} onChange={(event) => { setPauseDraft({ ...pauseDraft, untilDate: event.target.value }); setPreview(null) }} /></label></div>
      <label className={styles.fullField}>Operational note<textarea rows={3} value={pauseDraft.note} onChange={(event) => { setPauseDraft({ ...pauseDraft, note: event.target.value }); setPreview(null) }} placeholder="Optional context for managers and audit" /></label>
      {preview ? <div className={styles.impact}><strong>{preview.target}</strong><div className={styles.impactGrid}><div><strong>{preview.consequence.affectedVisits}</strong><span>service obligations affected</span><span>{preview.consequence.materializedVisits} scheduled · {preview.consequence.expectedOccurrences} expected, not materialized</span></div><div><strong>{preview.consequence.assignedCleaners}</strong><span>cleaners released</span></div><div><strong>{preview.consequence.plannedLabourHours}</strong><span>required labour hours</span></div></div>{preview.consequence.blockers.map((blocker) => <div className={styles.blocker} key={blocker.id}>Already in progress: {blocker.site}</div>)}</div> : null}
      <div className={styles.modalActions}>{preview ? <button className="btn-secondary" onClick={() => setPreview(null)}>Change details</button> : null}<button className={preview?.consequence.canApply ? 'btn-danger' : 'btn-primary'} disabled={busy || !pauseDraft.reason.trim() || !pauseDraft.fromDate || !pauseDraft.untilDate || (preview ? !preview.consequence.canApply : false)} onClick={() => void (preview ? confirmPause() : previewPause())}>{busy ? 'Working…' : preview ? 'Confirm pause' : 'Preview impact'}</button></div>
    </section></div> : null}
  </section>
}
