'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addOperationalDays, formatOperationalTime, operationalDateKey } from '../../lib/operational-time'
import type { ScheduleHealthItem, ScheduleHealthState } from '../../modules/scheduling/schedule-health-core'
import styles from './ScheduleHealthPanel.module.css'

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
type Filter = 'all' | 'problems' | 'covered' | 'needs_staff' | 'missing' | 'paused' | 'conflicts' | 'unacknowledged'
type PauseDraft = { scope: 'client' | 'site' | 'job'; targetId: string; fromDate: string; untilDate: string; reason: string; note: string }
type PausePreview = { target: string; timezone: string; consequence: { canApply: boolean; affectedVisits: number; materializedVisits: number; expectedOccurrences: number; assignedCleaners: number; plannedLabourHours: number; blockers: Array<{ id: string; site: string }> } }

const PROBLEM_STATES = new Set<ScheduleHealthState>(['needs_staff', 'unassigned', 'expected_not_scheduled', 'unscheduled_service', 'cleaner_overlap', 'acknowledgement_pending'])
const labels: Record<ScheduleHealthState, string> = {
  covered: 'Covered', needs_staff: 'Needs staff', unassigned: 'Unassigned', expected_not_scheduled: 'Expected · not scheduled',
  unscheduled_service: 'Unscheduled service', service_paused: 'Service paused', cleaner_overlap: 'Cleaner overlap', acknowledgement_pending: 'Ack pending',
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) throw new Error(body?.error ?? 'Request failed')
  return body.data as T
}

export default function ScheduleHealthPanel({
  from, to, timezone, canManage, onChanged, onOpenServicePlan,
}: {
  from: string
  to: string
  timezone: string
  canManage: boolean
  onChanged: () => Promise<void> | void
  onOpenServicePlan: (servicePlanId: string) => void
}) {
  const router = useRouter()
  const [data, setData] = useState<Result | null>(null)
  const [filter, setFilter] = useState<Filter>('problems')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pauseItem, setPauseItem] = useState<ScheduleHealthItem | null>(null)
  const [pauseDraft, setPauseDraft] = useState<PauseDraft | null>(null)
  const [preview, setPreview] = useState<PausePreview | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await api<Result>(`/api/schedule-health?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load schedule health.') }
    finally { setLoading(false) }
  }, [from, to])
  useEffect(() => { void refresh() }, [refresh])

  const visible = useMemo(() => (data?.items ?? []).filter((item) => {
    if (filter === 'all') return true
    if (filter === 'problems') return PROBLEM_STATES.has(item.state)
    if (filter === 'covered') return item.state === 'covered'
    if (filter === 'needs_staff') return item.state === 'needs_staff' || item.state === 'unassigned'
    if (filter === 'missing') return item.state === 'expected_not_scheduled' || item.state === 'unscheduled_service'
    if (filter === 'paused') return item.state === 'service_paused'
    if (filter === 'conflicts') return item.state === 'cleaner_overlap'
    return item.state === 'acknowledgement_pending'
  }), [data?.items, filter])

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
    setBusy(true); setError('')
    try {
      await api('/api/schedule-health', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: item.scheduledStart, to: new Date(new Date(item.scheduledEnd).getTime() + 60_000).toISOString(), jobIds: [item.jobId] }),
      })
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

  const summary = data?.summary
  const stats = summary ? [
    { label: 'Visits', value: summary.visits, filter: 'all' as Filter },
    { label: 'Covered', value: summary.covered, filter: 'covered' as Filter },
    { label: 'Need staff', value: summary.needsStaff + summary.unassigned, filter: 'needs_staff' as Filter },
    { label: 'Missing schedule', value: summary.missingSchedule + summary.unscheduledServices, filter: 'missing' as Filter },
    { label: 'Paused', value: summary.paused, filter: 'paused' as Filter },
    { label: 'Conflicts', value: summary.conflicts, filter: 'conflicts' as Filter },
    { label: 'Unacknowledged', value: summary.unacknowledged, filter: 'unacknowledged' as Filter },
  ] : []

  return <section className={styles.panel} aria-label="Schedule intelligence and service continuity">
    {summary ? <div className={styles.healthBar}>{stats.map((stat) => <button key={stat.label} className={styles.stat} data-active={filter === stat.filter} onClick={() => setFilter(stat.filter)}><strong>{stat.value}</strong><span>{stat.label}</span></button>)}</div> : null}
    <div className={styles.filters}>
      {([['all', 'All operational'], ['problems', 'Problems only'], ['needs_staff', 'Needs staff'], ['missing', 'Missing schedule'], ['paused', 'Paused'], ['unacknowledged', 'Unacknowledged']] as Array<[Filter, string]>).map(([key, label]) => <button key={key} data-active={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
      <button className={styles.sync} disabled={loading || busy} onClick={() => void refresh()}>{loading ? 'Checking…' : 'Refresh health'}</button>
    </div>
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {message ? <div className="toast success" role="status">{message}<button className="notice-close" onClick={() => setMessage('')}>×</button></div> : null}
    <div className={styles.list}>
      {!loading && !visible.length ? <div className={styles.empty}>{filter === 'problems' ? 'No operational scheduling problems in this window.' : 'No items match this health filter.'}</div> : null}
      {visible.slice(0, 120).map((item) => {
        const start = item.scheduledStart ? new Date(item.scheduledStart) : null
        const zone = item.timezone ?? timezone
        const pauseable = canManage && item.jobId && ['covered', 'needs_staff', 'unassigned'].includes(item.state)
        return <article key={item.id} className={styles.item} data-state={item.state}>
          <div className={styles.state}><span aria-hidden="true">{item.state === 'covered' ? '✓' : item.state === 'service_paused' ? '⏸' : item.state === 'cleaner_overlap' || item.state === 'expected_not_scheduled' ? '⛔' : '⚠'}</span>{labels[item.state]}</div>
          <div className={styles.copy}><strong>{item.clientName}{item.siteName ? ` · ${item.siteName}` : ''}</strong><span>{item.jobName ?? item.servicePlanName ?? 'Service plan'}</span><small>{item.detail}</small></div>
          <div className={styles.when}>{start ? <><strong>{start.toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone })}</strong><span>{formatOperationalTime(start, zone)}{item.requiredWorkers ? ` · ${item.activeWorkers ?? 0}/${item.requiredWorkers}` : ''}</span></> : <span>Needs scheduling definition</span>}</div>
          <div className={styles.actions}>
            {canManage && item.state === 'expected_not_scheduled' && item.jobId && !item.visitId ? <button className="btn-primary" disabled={busy} onClick={() => void ensureOccurrence(item)}>Schedule now</button> : null}
            {canManage && item.state === 'expected_not_scheduled' && item.visitId ? <button className="btn-secondary" onClick={() => router.push(`/schedule?visit=${item.visitId}`)}>Review cancelled visit</button> : null}
            {canManage && item.state === 'unscheduled_service' && item.servicePlanId ? <button className="btn-primary" onClick={() => onOpenServicePlan(item.servicePlanId!)}>Create schedule</button> : null}
            {pauseable ? <button className="btn-secondary" onClick={() => openPause(item)}>Pause service</button> : null}
            {canManage && item.state === 'service_paused' && item.pauseId ? <button className="btn-secondary" disabled={busy} onClick={() => void endPause(item)}>End pause early</button> : null}
          </div>
        </article>
      })}
    </div>
    {pauseItem && pauseDraft ? <div className={styles.modalOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setPauseItem(null); setPauseDraft(null); setPreview(null) } }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="pause-service-title">
      <header><div><span className="eyebrow">Service continuity</span><h3 id="pause-service-title">Pause service</h3><p className="muted">See the operational consequence before cancelling future work.</p></div><button className="btn-secondary" onClick={() => { setPauseItem(null); setPauseDraft(null); setPreview(null) }}>Close</button></header>
      <div className={styles.formGrid}><label>Scope<select value={pauseDraft.scope} onChange={(event) => changeScope(event.target.value as PauseDraft['scope'])}>{pauseItem.jobId ? <option value="job">This recurring service</option> : null}{pauseItem.siteId ? <option value="site">This site</option> : null}{pauseItem.clientId ? <option value="client">Entire client</option> : null}</select></label><label>Reason<input value={pauseDraft.reason} onChange={(event) => { setPauseDraft({ ...pauseDraft, reason: event.target.value }); setPreview(null) }} /></label><label>From<input type="date" value={pauseDraft.fromDate} onChange={(event) => { setPauseDraft({ ...pauseDraft, fromDate: event.target.value }); setPreview(null) }} /></label><label>Until (inclusive)<input type="date" min={pauseDraft.fromDate} value={pauseDraft.untilDate} onChange={(event) => { setPauseDraft({ ...pauseDraft, untilDate: event.target.value }); setPreview(null) }} /></label></div>
      <label className={styles.fullField}>Operational note<textarea rows={3} value={pauseDraft.note} onChange={(event) => { setPauseDraft({ ...pauseDraft, note: event.target.value }); setPreview(null) }} placeholder="Optional context for managers and audit" /></label>
      {preview ? <div className={styles.impact}><strong>{preview.target}</strong><div className={styles.impactGrid}><div><strong>{preview.consequence.affectedVisits}</strong><span>service obligations affected</span><span>{preview.consequence.materializedVisits} scheduled · {preview.consequence.expectedOccurrences} expected, not materialized</span></div><div><strong>{preview.consequence.assignedCleaners}</strong><span>cleaners released</span></div><div><strong>{preview.consequence.plannedLabourHours}</strong><span>required labour hours</span></div></div>{preview.consequence.blockers.map((blocker) => <div className={styles.blocker} key={blocker.id}>Already in progress: {blocker.site}</div>)}</div> : null}
      <div className={styles.modalActions}>{preview ? <button className="btn-secondary" onClick={() => setPreview(null)}>Change details</button> : null}<button className={preview?.consequence.canApply ? 'btn-danger' : 'btn-primary'} disabled={busy || !pauseDraft.reason.trim() || !pauseDraft.fromDate || !pauseDraft.untilDate || (preview ? !preview.consequence.canApply : false)} onClick={() => void (preview ? confirmPause() : previewPause())}>{busy ? 'Working…' : preview ? 'Confirm pause' : 'Preview impact'}</button></div>
    </section></div> : null}
  </section>
}
