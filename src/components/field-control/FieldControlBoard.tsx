'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { operationalDayRange } from '../../lib/operational-time'
import './FieldControlReview.css'

type Person = { id: string; name: string | null; email: string }
type LocationEvent = { id: string; kind: string; capturedAt: string; distanceM: number | null; accuracyM: number | null; classification: string | null }
type TimeEntry = {
  id: string
  status: string
  startedAt: string
  durationSeconds: number | null
  startDistanceM: number | null
  startLocationClass: string | null
  reviewReason: string | null
  user: Person
  visit: { id: string; site: { name: string; client: { displayName: string } } } | null
  locationEvents: LocationEvent[]
  disputes?: Array<{ id: string; reason: string; createdAt: string }>
}
type Incident = {
  id: string
  category: string
  severity: string
  title: string
  description?: string
  status: string
  createdAt: string
  reporter: Person
  visit: { id: string; scheduledStart: string; site: { name: string; client: { displayName: string } } }
}
type VisitReview = { id: string; decision: string; note: string | null; createdAt: string; reviewer: Person }
type VisitReviewCandidate = { id: string; completedAt: string | null; site: { name: string; client: { displayName: string } }; taskResults: Array<{ status: string }>; evidenceAssets: Array<{ id: string; kind: string; visibility: string }>; incidents: Array<{ id: string; status: string; severity: string }>; reviews: VisitReview[] }
type Visit = {
  id: string
  scheduledStart: string
  scheduledEnd: string
  status: string
  site: { name: string; city: string; client: { displayName: string } }
  job: { name: string }
  assignments: Array<{ status: string; user: Person }>
  taskResults: Array<{ status: string }>
  timeEntries: Array<Pick<TimeEntry, 'id' | 'status' | 'startedAt' | 'durationSeconds' | 'startDistanceM' | 'startLocationClass' | 'reviewReason'> & { userId: string }>
  incidents: Array<Pick<Incident, 'id' | 'category' | 'severity' | 'title' | 'status' | 'createdAt'>>
  _count: { evidenceAssets: number }
}
type ScheduleHealth = { summary: { visits: number; needsStaff: number; unassigned: number; missingSchedule: number; unscheduledServices: number; conflicts: number; unacknowledged: number } }
type ControlData = {
  summary: { visits: number; completed: number; inProgress: number; blocked: number; activeTimers: number; needsReview: number; openIncidents: number; criticalIncidents: number }
  visits: Visit[]
  reviewEntries: TimeEntry[]
  visitReviews: VisitReviewCandidate[]
  activeTimers: Array<Omit<TimeEntry, 'locationEvents' | 'startDistanceM' | 'startLocationClass' | 'reviewReason' | 'durationSeconds'>>
  incidents: Incident[]
}
type ReviewCase =
  | { key: string; kind: 'time'; entry: TimeEntry }
  | { key: string; kind: 'evidence'; visit: VisitReviewCandidate }

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Request failed')
  return body.data as T
}

function time(value: string, timezone = 'Europe/Dublin') {
  return new Date(value).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
}

function duration(seconds: number | null, startedAt?: string) {
  const total = seconds ?? (startedAt ? Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)) : 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

function personName(person: Person) {
  return person.name || person.email
}

function friendlyReviewReason(reason: string | null) {
  if (!reason) return 'Execution check needs a manager decision.'
  if (reason.includes('REPEATED_LOCATION_PATTERN')) return 'Repeated location pattern detected at this site.'
  if (reason.includes('LOCATION_FAR_FROM_SITE')) return 'A location check was captured far from the expected site.'
  if (reason.includes('LOCATION_OUTSIDE_GEOFENCE')) return 'A location check was confidently outside the expected site area.'
  if (reason.includes('GPS_UNAVAILABLE')) return 'GPS evidence was unavailable for a required location check.'
  if (reason.includes('GPS_UNCERTAIN')) return 'GPS accuracy was too weak to verify the location confidently.'
  return reason.replaceAll('_', ' ').toLowerCase()
}

function locationTone(point: LocationEvent | undefined) {
  if (!point || point.classification === 'unavailable') return 'review'
  if (point.classification === 'verified') return 'verified'
  if (point.classification === 'near') return 'watch'
  return 'review'
}

function locationLabel(point: LocationEvent | undefined) {
  if (!point) return 'Not captured'
  if (point.classification === 'verified') return 'Verified'
  if (point.classification === 'near') return 'Watch'
  if (point.classification === 'suspicious') return 'Review'
  return 'GPS unavailable'
}

function locationMeta(point: LocationEvent | undefined) {
  if (!point) return 'No location evidence'
  const distance = point.distanceM == null ? 'distance unavailable' : `${point.distanceM}m from site`
  const accuracy = point.accuracyM == null ? 'accuracy unknown' : `GPS ±${Math.round(point.accuracyM)}m`
  return `${distance} · ${accuracy}`
}

export default function FieldControlBoard({ timezone }: { timezone: string }) {
  const [data, setData] = useState<ControlData | null>(null)
  const [health, setHealth] = useState<ScheduleHealth | null>(null)
  const [tab, setTab] = useState<'live' | 'review' | 'incidents'>('live')
  const [selectedReviewKey, setSelectedReviewKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const range = operationalDayRange(new Date(), timezone)
      const [controlData, healthData] = await Promise.all([
        api<ControlData>('/api/field-control'),
        api<ScheduleHealth>(`/api/schedule-health?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
      ])
      setData(controlData)
      setHealth(healthData)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load field control.' })
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [timezone])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(true), 30_000)
    return () => clearInterval(timer)
  }, [refresh])

  async function review(entryId: string, decision: 'approved' | 'rejected') {
    setBusyId(entryId)
    try {
      await api(`/api/time-entries/${entryId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: notes[entryId] || undefined }),
      })
      setNotice({ kind: 'success', text: decision === 'approved' ? 'Execution record approved.' : 'Execution record returned for correction.' })
      setSelectedReviewKey(null)
      await refresh(true)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not review entry.' })
    } finally {
      setBusyId(null)
    }
  }

  async function resolveDispute(disputeId: string, decision: 'accepted' | 'declined') {
    const resolution = notes[disputeId] || ''
    setBusyId(disputeId)
    try {
      await api(`/api/time-entry-disputes/${disputeId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, resolution }),
      })
      setNotice({ kind: 'success', text: decision === 'accepted' ? 'Correction request accepted.' : 'Correction request closed with an explanation.' })
      await refresh(true)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not resolve the correction request.' })
    } finally { setBusyId(null) }
  }

  async function reviewVisit(visitId: string, decision: 'approved' | 'rework_requested') {
    setBusyId(visitId)
    try {
      await api(`/api/visits/${visitId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, note: notes[visitId] || undefined }) })
      setNotice({ kind: 'success', text: decision === 'approved' ? 'Visit evidence approved.' : 'Visit returned to the field team with rework instructions.' })
      setSelectedReviewKey(null)
      await refresh(true)
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not review visit evidence.' }) } finally { setBusyId(null) }
  }

  async function updateIncident(incidentId: string, status: 'acknowledged' | 'in_progress' | 'resolved') {
    setBusyId(incidentId)
    try {
      await api(`/api/incidents/${incidentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, resolution: notes[incidentId] || undefined }),
      })
      setNotice({ kind: 'success', text: status === 'resolved' ? 'Incident resolved.' : 'Incident status updated.' })
      await refresh(true)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not update incident.' })
    } finally {
      setBusyId(null)
    }
  }

  const attentionVisits = useMemo(() => data?.visits.filter((visit) => visit.status === 'completion_blocked' || visit.incidents.some((incident) => incident.severity === 'critical')) ?? [], [data])
  const schedulingAttention = useMemo(() => health ? health.summary.needsStaff + health.summary.unassigned + health.summary.missingSchedule + health.summary.unscheduledServices + health.summary.conflicts + health.summary.unacknowledged : 0, [health])
  const reviewCases = useMemo<ReviewCase[]>(() => data ? [
    ...data.reviewEntries.map((entry) => ({ key: `time:${entry.id}`, kind: 'time' as const, entry })),
    ...data.visitReviews.map((visit) => ({ key: `evidence:${visit.id}`, kind: 'evidence' as const, visit })),
  ] : [], [data])
  const selectedReview = useMemo(() => reviewCases.find((item) => item.key === selectedReviewKey) ?? null, [reviewCases, selectedReviewKey])

  return <main className="page-shell field-control-page">
    <header className="page-header field-control-hero">
      <div><span className="eyebrow">Live cleaning operations</span><h1>Field control</h1><p className="muted">See active execution and resolve only the exceptions that need a manager decision.</p></div>
      <button className="btn-secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
    </header>

    {notice ? <div className={`toast ${notice.kind}`} role="status">{notice.text}<button className="notice-close" onClick={() => setNotice(null)}>×</button></div> : null}
    {loading ? <section className="card empty-state">Connecting to field activity…</section> : null}

    {data ? <>
      <section className="field-metrics" aria-label="Operational summary">
        <button onClick={() => setTab('live')}><span>Visits today</span><strong>{health?.summary.visits ?? data.summary.visits}</strong><small>{schedulingAttention} scheduling issues · {data.summary.completed} complete</small></button>
        <button onClick={() => setTab('live')} className={data.summary.activeTimers ? 'active-metric' : ''}><span>Live now</span><strong>{data.summary.activeTimers}</strong><small>Active execution sessions</small></button>
        <button onClick={() => { setTab('review'); setSelectedReviewKey(null) }} className={data.summary.needsReview ? 'attention-metric' : ''}><span>Needs review</span><strong>{data.summary.needsReview}</strong><small>GPS or execution evidence</small></button>
        <button onClick={() => setTab('incidents')} className={data.summary.criticalIncidents ? 'critical-metric' : ''}><span>Open incidents</span><strong>{data.summary.openIncidents}</strong><small>{data.summary.criticalIncidents} critical</small></button>
      </section>

      <section className="field-tabs" aria-label="Field control views">
        <div className="segmented-control">
          <button className={tab === 'live' ? 'selected' : ''} onClick={() => setTab('live')}>Live board</button>
          <button className={tab === 'review' ? 'selected' : ''} onClick={() => { setTab('review'); setSelectedReviewKey(null) }}>Review queue <span>{data.summary.needsReview}</span></button>
          <button className={tab === 'incidents' ? 'selected' : ''} onClick={() => setTab('incidents')}>Incidents <span>{data.summary.openIncidents}</span></button>
        </div>
        <span className="muted">Auto-refreshes every 30 seconds</span>
      </section>

      {tab === 'live' ? <section className="field-live-layout">
        <div className="field-visit-list">
          <div className="section-heading"><h2>Today&apos;s execution</h2><span className="count-pill">{data.visits.length}</span></div>
          {data.visits.map((visit) => {
            const done = visit.taskResults.filter((task) => task.status !== 'pending').length
            const total = visit.taskResults.length
            const active = visit.timeEntries.find((entry) => entry.status === 'running')
            return <article className="field-visit-card" key={visit.id} data-status={visit.status}>
              <div className="visit-clock"><strong>{time(visit.scheduledStart, timezone)}</strong><span>{time(visit.scheduledEnd, timezone)}</span></div>
              <div className="visit-main"><div className="row"><strong>{visit.site.client.displayName}</strong><span className={`status-badge ${visit.status === 'completed' ? 'Completed' : 'Pending'}`}>{visit.status.replaceAll('_', ' ')}</span></div><span>{visit.site.name} · {visit.job.name}</span><small>{visit.assignments.map((assignment) => personName(assignment.user)).join(', ') || 'Unassigned'}</small></div>
              <div className="visit-progress"><div><span style={{ width: `${total ? done / total * 100 : 0}%` }} /></div><small>{done}/{total || '—'} tasks · {visit._count.evidenceAssets} evidence</small></div>
              <div className="visit-signal">{active ? <><span className={`location-pill ${active.startLocationClass ?? 'unavailable'}`}>Start GPS: {active.startLocationClass ?? 'unavailable'}</span><strong>{duration(active.durationSeconds, active.startedAt)}</strong><small>{active.startDistanceM == null ? 'distance unavailable' : `${active.startDistanceM}m from site at timer start`}</small></> : <span className="muted">No active timer</span>}</div>
            </article>
          })}
          {!data.visits.length ? <div className="card empty-state">No visits scheduled today.</div> : null}
        </div>
        <aside className="field-attention card"><div className="section-heading"><h2>Attention now</h2><span className="count-pill">{attentionVisits.length + (schedulingAttention ? 1 : 0)}</span></div>{schedulingAttention ? <a href="/schedule"><strong>Schedule health</strong><span>{schedulingAttention} scheduling issue{schedulingAttention === 1 ? '' : 's'}</span><small>Coverage, recurrence, conflicts or acknowledgements need attention</small></a> : null}{attentionVisits.map((visit) => <a key={visit.id} href={`/schedule?visit=${visit.id}`}><strong>{visit.site.client.displayName}</strong><span>{visit.site.name}</span><small>{visit.status.replaceAll('_', ' ')} · {visit.incidents.length} incidents</small></a>)}{!attentionVisits.length && !schedulingAttention ? <div className="empty-state compact">No critical blockers.</div> : null}</aside>
      </section> : null}

      {tab === 'review' ? <section className="field-review-workspace">
        {!selectedReview ? <>
          <div className="section-heading"><div><h2>Review queue</h2><p className="muted">Only decisions land here. Near-site watch signals remain history unless a reliable pattern escalates.</p></div><span className="count-pill">{reviewCases.length}</span></div>
          <div className="field-review-list">
            {reviewCases.map((reviewCase) => reviewCase.kind === 'time' ? (() => {
              const entry = reviewCase.entry
              const clockIn = entry.locationEvents.find((point) => point.kind === 'clock_in')
              const clockOut = [...entry.locationEvents].reverse().find((point) => point.kind === 'clock_out')
              const worst = [clockIn, clockOut].find((point) => locationTone(point) === 'review') ?? clockIn ?? clockOut
              return <button type="button" className="field-review-row" key={reviewCase.key} onClick={() => setSelectedReviewKey(reviewCase.key)}>
                <span className={`field-review-severity ${locationTone(worst)}`}>GPS</span>
                <span className="field-review-copy"><strong>{personName(entry.user)}</strong><small>{entry.visit ? `${entry.visit.site.client.displayName} · ${entry.visit.site.name}` : 'General time'}</small><span>{friendlyReviewReason(entry.reviewReason)}</span></span>
                <span className="field-review-meta"><strong>{duration(entry.durationSeconds)}</strong><small>{time(entry.startedAt, timezone)}</small></span>
                <span className="field-review-open">Review →</span>
              </button>
            })() : (() => {
              const visit = reviewCase.visit
              return <button type="button" className="field-review-row" key={reviewCase.key} onClick={() => setSelectedReviewKey(reviewCase.key)}>
                <span className="field-review-severity evidence">Proof</span>
                <span className="field-review-copy"><strong>{visit.site.client.displayName} · {visit.site.name}</strong><small>Visit evidence</small><span>{visit.evidenceAssets.length} proof item{visit.evidenceAssets.length === 1 ? '' : 's'} waiting for approval</span></span>
                <span className="field-review-meta"><strong>{visit.taskResults.filter((task) => task.status === 'done' || task.status === 'not_applicable').length}/{visit.taskResults.length || '—'}</strong><small>tasks</small></span>
                <span className="field-review-open">Review →</span>
              </button>
            })())}
            {!reviewCases.length ? <div className="card empty-state">No execution or evidence cases need a decision.</div> : null}
          </div>
        </> : selectedReview.kind === 'time' ? (() => {
          const entry = selectedReview.entry
          const clockIn = entry.locationEvents.find((point) => point.kind === 'clock_in')
          const clockOut = [...entry.locationEvents].reverse().find((point) => point.kind === 'clock_out')
          return <article className="field-review-detail card">
            <header className="field-review-detail-head"><button type="button" className="text-button" onClick={() => setSelectedReviewKey(null)}>← Review queue</button><span className="field-review-severity review">Needs decision</span></header>
            <div className="field-review-title"><span className="eyebrow">GPS execution check</span><h2>{personName(entry.user)}</h2><p>{entry.visit ? `${entry.visit.site.client.displayName} · ${entry.visit.site.name}` : 'General time entry'} · {duration(entry.durationSeconds)}</p></div>
            <div className="field-review-explanation"><strong>Why this needs review</strong><span>{friendlyReviewReason(entry.reviewReason)}</span></div>
            <div className="field-location-checks">
              <div data-tone={locationTone(clockIn)}><header><strong>Clock in</strong><span>{locationLabel(clockIn)}</span></header><b>{clockIn ? time(clockIn.capturedAt, timezone) : '—'}</b><small>{locationMeta(clockIn)}</small></div>
              <div data-tone={locationTone(clockOut)}><header><strong>Clock out</strong><span>{locationLabel(clockOut)}</span></header><b>{clockOut ? time(clockOut.capturedAt, timezone) : '—'}</b><small>{locationMeta(clockOut)}</small></div>
            </div>
            {entry.locationEvents.length > 2 ? <div className="gps-timeline" aria-label="GPS waypoint timeline">{entry.locationEvents.map((point) => <div key={point.id} className={`gps-point ${point.classification ?? 'unavailable'}`}><i /><strong>{point.kind.replace('_', ' ')}</strong><span>{time(point.capturedAt, timezone)}</span><small>{locationMeta(point)}</small></div>)}</div> : null}
            {entry.disputes?.map((dispute) => <section className="field-worker-request" key={dispute.id}><span className="eyebrow">Worker correction request</span><p>{dispute.reason}</p><label>Response to worker<input value={notes[dispute.id] ?? ''} onChange={(event) => setNotes({ ...notes, [dispute.id]: event.target.value })} placeholder="Explain the decision" /></label><div><button className="btn-secondary" disabled={busyId === dispute.id || !(notes[dispute.id] ?? '').trim()} onClick={() => void resolveDispute(dispute.id, 'declined')}>Keep original</button><button className="btn-primary" disabled={busyId === dispute.id || !(notes[dispute.id] ?? '').trim()} onClick={() => void resolveDispute(dispute.id, 'accepted')}>Accept correction</button></div></section>)}
            <section className="field-review-decision"><label>Manager note<input value={notes[entry.id] ?? ''} onChange={(event) => setNotes({ ...notes, [entry.id]: event.target.value })} placeholder="Optional when approving · required when returning" /></label><div><button className="btn-secondary" disabled={busyId === entry.id || !(notes[entry.id] ?? '').trim()} onClick={() => void review(entry.id, 'rejected')}>Return for correction</button><button className="btn-primary" disabled={busyId === entry.id} onClick={() => void review(entry.id, 'approved')}>Approve execution record</button></div></section>
          </article>
        })() : (() => {
          const visit = selectedReview.visit
          const latest = visit.reviews[0]
          const completed = visit.taskResults.filter((task) => task.status === 'done' || task.status === 'not_applicable').length
          return <article className="field-review-detail card">
            <header className="field-review-detail-head"><button type="button" className="text-button" onClick={() => setSelectedReviewKey(null)}>← Review queue</button><span className="field-review-severity evidence">Evidence</span></header>
            <div className="field-review-title"><span className="eyebrow">Visit evidence review</span><h2>{visit.site.client.displayName} · {visit.site.name}</h2><p>Completed {visit.completedAt ? time(visit.completedAt, timezone) : '—'}</p></div>
            <div className="field-evidence-summary"><div><strong>{completed}/{visit.taskResults.length || '—'}</strong><span>tasks completed</span></div><div><strong>{visit.evidenceAssets.length}</strong><span>proof items</span></div><div><strong>{visit.incidents.filter((incident) => !['resolved', 'closed'].includes(incident.status)).length}</strong><span>open incidents</span></div></div>
            {latest ? <div className="field-review-explanation"><strong>Previous decision</strong><span>{latest.decision.replaceAll('_', ' ')}</span></div> : null}
            <section className="field-review-decision"><label>Supervisor note<input value={notes[visit.id] ?? ''} onChange={(event) => setNotes({ ...notes, [visit.id]: event.target.value })} placeholder="Required when sending back for rework" /></label><div><button className="btn-secondary" disabled={busyId === visit.id || !(notes[visit.id] ?? '').trim()} onClick={() => void reviewVisit(visit.id, 'rework_requested')}>Send for rework</button><button className="btn-primary" disabled={busyId === visit.id} onClick={() => void reviewVisit(visit.id, 'approved')}>Approve evidence</button></div></section>
          </article>
        })()}
      </section> : null}

      {tab === 'incidents' ? <section className="incident-list">
        <div className="section-heading"><h2>Operational incidents</h2><span className="muted">Keep the resolution beside the visit, not lost in chat.</span></div>
        {data.incidents.map((incident) => <article className="incident-card card" key={incident.id} data-severity={incident.severity}>
          <header><div><span className={`severity-pill ${incident.severity}`}>{incident.severity}</span><strong>{incident.title}</strong></div><span className="status-badge Pending">{incident.status.replace('_', ' ')}</span></header>
          <p>{incident.description}</p><div className="incident-context"><span>{incident.visit.site.client.displayName} · {incident.visit.site.name}</span><span>Reported by {personName(incident.reporter)}</span><span>{new Date(incident.createdAt).toLocaleString('en-IE')}</span></div>
          <div className="incident-actions"><label>Resolution / next action<input value={notes[incident.id] ?? ''} onChange={(event) => setNotes({ ...notes, [incident.id]: event.target.value })} placeholder="What happened and what was done?" /></label>{incident.status === 'open' ? <button className="btn-secondary" disabled={busyId === incident.id} onClick={() => void updateIncident(incident.id, 'acknowledged')}>Acknowledge</button> : null}<button className="btn-secondary" disabled={busyId === incident.id} onClick={() => void updateIncident(incident.id, 'in_progress')}>In progress</button><button className="btn-primary" disabled={busyId === incident.id || !(notes[incident.id] ?? '').trim()} onClick={() => void updateIncident(incident.id, 'resolved')}>Resolve</button></div>
        </article>)}
        {!data.incidents.length ? <div className="card empty-state">No open incidents.</div> : null}
      </section> : null}
    </> : null}
  </main>
}
