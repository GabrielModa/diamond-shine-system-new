'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type Person = { id: string; name: string | null; email: string }
type LocationEvent = { id: string; kind: string; capturedAt: string; distanceM: number | null; classification: string | null }
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
type ControlData = {
  summary: { visits: number; completed: number; inProgress: number; blocked: number; activeTimers: number; needsReview: number; openIncidents: number; criticalIncidents: number }
  visits: Visit[]
  reviewEntries: TimeEntry[]
  activeTimers: Array<Omit<TimeEntry, 'locationEvents' | 'startDistanceM' | 'startLocationClass' | 'reviewReason' | 'durationSeconds'>>
  incidents: Incident[]
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Request failed')
  return body.data as T
}

function time(value: string) {
  return new Date(value).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
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

export default function FieldControlBoard() {
  const [data, setData] = useState<ControlData | null>(null)
  const [tab, setTab] = useState<'live' | 'review' | 'incidents'>('live')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      setData(await api<ControlData>('/api/field-control'))
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load field control.' })
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

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
      setNotice({ kind: 'success', text: decision === 'approved' ? 'Time entry approved.' : 'Time entry returned for correction.' })
      await refresh(true)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not review entry.' })
    } finally {
      setBusyId(null)
    }
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

  return <main className="page-shell field-control-page">
    <header className="page-header field-control-hero">
      <div><span className="eyebrow">Live cleaning operations</span><h1>Field control</h1><p className="muted">See progress, GPS confidence and exceptions without interrupting the team on site.</p></div>
      <button className="btn-secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
    </header>

    {notice ? <div className={`toast ${notice.kind}`} role="status">{notice.text}<button className="notice-close" onClick={() => setNotice(null)}>×</button></div> : null}
    {loading ? <section className="card empty-state">Connecting to field activity…</section> : null}

    {data ? <>
      <section className="field-metrics" aria-label="Operational summary">
        <button onClick={() => setTab('live')}><span>Visits today</span><strong>{data.summary.visits}</strong><small>{data.summary.completed} complete</small></button>
        <button onClick={() => setTab('live')} className={data.summary.activeTimers ? 'active-metric' : ''}><span>Live now</span><strong>{data.summary.activeTimers}</strong><small>{data.summary.inProgress} in progress</small></button>
        <button onClick={() => setTab('review')} className={data.summary.needsReview ? 'attention-metric' : ''}><span>Needs review</span><strong>{data.summary.needsReview}</strong><small>GPS or duration flags</small></button>
        <button onClick={() => setTab('incidents')} className={data.summary.criticalIncidents ? 'critical-metric' : ''}><span>Open incidents</span><strong>{data.summary.openIncidents}</strong><small>{data.summary.criticalIncidents} critical</small></button>
      </section>

      <section className="field-tabs" aria-label="Field control views">
        <div className="segmented-control">
          <button className={tab === 'live' ? 'selected' : ''} onClick={() => setTab('live')}>Live board</button>
          <button className={tab === 'review' ? 'selected' : ''} onClick={() => setTab('review')}>Time review <span>{data.summary.needsReview}</span></button>
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
              <div className="visit-clock"><strong>{time(visit.scheduledStart)}</strong><span>{time(visit.scheduledEnd)}</span></div>
              <div className="visit-main"><div className="row"><strong>{visit.site.client.displayName}</strong><span className={`status-badge ${visit.status === 'completed' ? 'Completed' : 'Pending'}`}>{visit.status.replaceAll('_', ' ')}</span></div><span>{visit.site.name} · {visit.job.name}</span><small>{visit.assignments.map((assignment) => personName(assignment.user)).join(', ') || 'Unassigned'}</small></div>
              <div className="visit-progress"><div><span style={{ width: `${total ? done / total * 100 : 0}%` }} /></div><small>{done}/{total || '—'} tasks · {visit._count.evidenceAssets} evidence</small></div>
              <div className="visit-signal">{active ? <><span className={`location-pill ${active.startLocationClass ?? 'unavailable'}`}>{active.startLocationClass ?? 'no GPS'}</span><strong>{duration(active.durationSeconds, active.startedAt)}</strong><small>{active.startDistanceM == null ? 'distance unavailable' : `${active.startDistanceM}m from site`}</small></> : <span className="muted">No active timer</span>}</div>
            </article>
          })}
          {!data.visits.length ? <div className="card empty-state">No visits scheduled today.</div> : null}
        </div>
        <aside className="field-attention card"><div className="section-heading"><h2>Attention now</h2><span className="count-pill">{attentionVisits.length}</span></div>{attentionVisits.map((visit) => <a key={visit.id} href={`/schedule?visit=${visit.id}`}><strong>{visit.site.client.displayName}</strong><span>{visit.site.name}</span><small>{visit.status.replaceAll('_', ' ')} · {visit.incidents.length} incidents</small></a>)}{!attentionVisits.length ? <div className="empty-state compact">No critical blockers.</div> : null}</aside>
      </section> : null}

      {tab === 'review' ? <section className="review-list">
        <div className="section-heading"><h2>Exception-based time review</h2><span className="muted">Clean entries pass automatically; only anomalies land here.</span></div>
        {data.reviewEntries.map((entry) => <article className="review-card card" key={entry.id}>
          <header><div><strong>{personName(entry.user)}</strong><span>{entry.visit ? `${entry.visit.site.client.displayName} · ${entry.visit.site.name}` : 'General time'}</span></div><div><strong>{duration(entry.durationSeconds)}</strong><span>{time(entry.startedAt)}</span></div></header>
          <div className="review-reasons"><span className={`location-pill ${entry.startLocationClass ?? 'unavailable'}`}>{entry.startLocationClass ?? 'unavailable'}</span><span>{entry.startDistanceM == null ? 'No site distance' : `${entry.startDistanceM}m from site`}</span><span>{entry.reviewReason}</span></div>
          <div className="gps-timeline" aria-label="GPS waypoint timeline">{entry.locationEvents.map((point) => <div key={point.id} className={`gps-point ${point.classification ?? 'unavailable'}`}><i /><strong>{point.kind.replace('_', ' ')}</strong><span>{time(point.capturedAt)}</span><small>{point.distanceM == null ? 'GPS only' : `${point.distanceM}m`}</small></div>)}{!entry.locationEvents.length ? <span className="muted">No GPS waypoints captured.</span> : null}</div>
          <div className="review-actions"><label>Manager note<input value={notes[entry.id] ?? ''} onChange={(event) => setNotes({ ...notes, [entry.id]: event.target.value })} placeholder="Required when rejecting" /></label><button className="btn-secondary" disabled={busyId === entry.id || !(notes[entry.id] ?? '').trim()} onClick={() => void review(entry.id, 'rejected')}>Return</button><button className="btn-primary" disabled={busyId === entry.id} onClick={() => void review(entry.id, 'approved')}>Approve</button></div>
        </article>)}
        {!data.reviewEntries.length ? <div className="card empty-state">No time entries need review.</div> : null}
      </section> : null}

      {tab === 'incidents' ? <section className="incident-list">
        <div className="section-heading"><h2>Operational incidents</h2><span className="muted">Keep the resolution beside the visit, not lost in chat.</span></div>
        {data.incidents.map((incident) => <article className="incident-card card" key={incident.id} data-severity={incident.severity}>
          <header><div><span className={`severity-pill ${incident.severity}`}>{incident.severity}</span><strong>{incident.title}</strong></div><span className={`status-badge Pending`}>{incident.status.replace('_', ' ')}</span></header>
          <p>{incident.description}</p><div className="incident-context"><span>{incident.visit.site.client.displayName} · {incident.visit.site.name}</span><span>Reported by {personName(incident.reporter)}</span><span>{new Date(incident.createdAt).toLocaleString('en-IE')}</span></div>
          <div className="incident-actions"><label>Resolution / next action<input value={notes[incident.id] ?? ''} onChange={(event) => setNotes({ ...notes, [incident.id]: event.target.value })} placeholder="What happened and what was done?" /></label>{incident.status === 'open' ? <button className="btn-secondary" disabled={busyId === incident.id} onClick={() => void updateIncident(incident.id, 'acknowledged')}>Acknowledge</button> : null}<button className="btn-secondary" disabled={busyId === incident.id} onClick={() => void updateIncident(incident.id, 'in_progress')}>In progress</button><button className="btn-primary" disabled={busyId === incident.id || !(notes[incident.id] ?? '').trim()} onClick={() => void updateIncident(incident.id, 'resolved')}>Resolve</button></div>
        </article>)}
        {!data.incidents.length ? <div className="card empty-state">No open incidents.</div> : null}
      </section> : null}
    </> : null}
  </main>
}

