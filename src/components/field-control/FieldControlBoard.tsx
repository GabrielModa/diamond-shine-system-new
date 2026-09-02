'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import OpsIcon from '../ui/OpsIcon'
import './FieldControlReview.css'

type Person = { id: string; name: string | null; email: string }
type LocationEvent = { id: string; kind: string; capturedAt: string; distanceM: number | null; accuracyM: number | null; classification: string | null }
type TimeEntry = {
  id: string
  status: string
  startedAt: string
  endedAt?: string | null
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
type VisitReviewCandidate = {
  id: string
  completedAt: string | null
  site: { name: string; client: { displayName: string } }
  taskResults: Array<{ status: string }>
  evidenceAssets: Array<{ id: string; kind: string; visibility: string }>
  incidents: Array<{ id: string; status: string; severity: string }>
  reviews: VisitReview[]
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
  visitReviews: VisitReviewCandidate[]
  activeTimers: Array<Omit<TimeEntry, 'locationEvents' | 'startDistanceM' | 'startLocationClass' | 'reviewReason' | 'durationSeconds'>>
  incidents: Incident[]
}
type ReviewCase =
  | { key: string; kind: 'time'; entry: TimeEntry }
  | { key: string; kind: 'evidence'; visit: VisitReviewCandidate }
type LiveFilter = 'all' | 'running' | 'attention' | 'completed' | 'no_timer'
type ReviewFilter = 'all' | 'gps' | 'evidence' | 'challenge'
type IncidentFilter = 'all' | 'critical' | 'active'

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Request failed')
  return body.data as T
}

function time(value: string, timezone = 'Europe/Dublin') {
  return new Date(value).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', timeZone: timezone })
}

function dateTime(value: string, timezone = 'Europe/Dublin') {
  return new Date(value).toLocaleString('en-IE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: timezone })
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
  if (reason.includes('PRESENCE_LOCATION_ANOMALY')) return 'A presence check during the visit was outside the expected site area.'
  if (reason.includes('LOCATION_FAR_FROM_SITE')) return 'A location check was captured far from the expected site.'
  if (reason.includes('LOCATION_OUTSIDE_GEOFENCE')) return 'A location check was confidently outside the expected site area.'
  if (reason.includes('GPS_UNAVAILABLE')) return 'GPS evidence was unavailable for a required location check.'
  if (reason.includes('GPS_UNCERTAIN')) return 'GPS accuracy was too weak to verify the location confidently.'
  return reason.split(' | ')[0].replaceAll('_', ' ').toLowerCase()
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

function visitNeedsAttention(visit: Visit) {
  return visit.status === 'completion_blocked'
    || visit.incidents.some((incident) => !['resolved', 'closed'].includes(incident.status))
    || visit.timeEntries.some((entry) => entry.status === 'needs_review' || Boolean(entry.reviewReason))
}

function reviewCaseSearch(caseItem: ReviewCase) {
  if (caseItem.kind === 'evidence') return `${caseItem.visit.site.client.displayName} ${caseItem.visit.site.name}`.toLowerCase()
  return `${personName(caseItem.entry.user)} ${caseItem.entry.user.email} ${caseItem.entry.visit?.site.client.displayName ?? ''} ${caseItem.entry.visit?.site.name ?? ''} ${caseItem.entry.reviewReason ?? ''}`.toLowerCase()
}

export default function FieldControlBoard({ timezone }: { timezone: string }) {
  const searchParams = useSearchParams()
  const deepLinkedEntry = searchParams.get('entry')
  const deepLinkedIncident = searchParams.get('incident')
  const [data, setData] = useState<ControlData | null>(null)
  const [tab, setTab] = useState<'live' | 'review' | 'incidents'>('live')
  const [liveFilter, setLiveFilter] = useState<LiveFilter>('all')
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [incidentFilter, setIncidentFilter] = useState<IncidentFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedReviewKey, setSelectedReviewKey] = useState<string | null>(null)
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

  useEffect(() => {
    if (deepLinkedEntry) {
      setTab('review')
      setReviewFilter('all')
      setSelectedReviewKey(`time:${deepLinkedEntry}`)
      setQuery('')
    } else if (deepLinkedIncident) {
      setTab('incidents')
      setIncidentFilter('all')
      setQuery('')
    }
  }, [deepLinkedEntry, deepLinkedIncident])

  async function review(entryId: string, decision: 'approved' | 'rejected') {
    setBusyId(entryId)
    try {
      await api(`/api/time-entries/${entryId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: notes[entryId] || undefined }),
      })
      setNotice({ kind: 'success', text: decision === 'approved' ? 'Execution record approved and available to Timesheets.' : 'Execution record returned for correction.' })
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
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, resolution }),
      })
      setNotice({ kind: 'success', text: decision === 'accepted' ? 'Worker correction accepted.' : 'Worker correction closed with an explanation.' })
      await refresh(true)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not resolve the correction request.' })
    } finally {
      setBusyId(null)
    }
  }

  async function reviewVisit(visitId: string, decision: 'approved' | 'rework_requested') {
    setBusyId(visitId)
    try {
      await api(`/api/visits/${visitId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: notes[visitId] || undefined }),
      })
      setNotice({ kind: 'success', text: decision === 'approved' ? 'Visit evidence approved.' : 'Visit returned to the field team with rework instructions.' })
      setSelectedReviewKey(null)
      await refresh(true)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not review visit evidence.' })
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

  const reviewCases = useMemo<ReviewCase[]>(() => data ? [
    ...data.reviewEntries.map((entry) => ({ key: `time:${entry.id}`, kind: 'time' as const, entry })),
    ...data.visitReviews.map((visit) => ({ key: `evidence:${visit.id}`, kind: 'evidence' as const, visit })),
  ] : [], [data])

  const selectedReview = useMemo(() => reviewCases.find((item) => item.key === selectedReviewKey) ?? null, [reviewCases, selectedReviewKey])

  const filteredVisits = useMemo(() => {
    if (!data) return []
    const needle = query.trim().toLowerCase()
    return data.visits.filter((visit) => {
      const running = visit.timeEntries.some((entry) => entry.status === 'running')
      if (liveFilter === 'running' && !running) return false
      if (liveFilter === 'attention' && !visitNeedsAttention(visit)) return false
      if (liveFilter === 'completed' && visit.status !== 'completed') return false
      if (liveFilter === 'no_timer' && (running || visit.status === 'completed')) return false
      if (!needle) return true
      return `${visit.site.client.displayName} ${visit.site.name} ${visit.job.name} ${visit.assignments.map((assignment) => personName(assignment.user)).join(' ')}`.toLowerCase().includes(needle)
    })
  }, [data, liveFilter, query])

  const filteredReviewCases = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return reviewCases.filter((caseItem) => {
      if (reviewFilter === 'gps' && caseItem.kind !== 'time') return false
      if (reviewFilter === 'evidence' && caseItem.kind !== 'evidence') return false
      if (reviewFilter === 'challenge' && (caseItem.kind !== 'time' || !caseItem.entry.disputes?.length)) return false
      return !needle || reviewCaseSearch(caseItem).includes(needle)
    })
  }, [query, reviewCases, reviewFilter])

  const filteredIncidents = useMemo(() => {
    if (!data) return []
    const needle = query.trim().toLowerCase()
    return data.incidents.filter((incident) => {
      if (incidentFilter === 'critical' && incident.severity !== 'critical') return false
      if (incidentFilter === 'active' && !['acknowledged', 'in_progress'].includes(incident.status)) return false
      if (!needle) return true
      return `${incident.title} ${incident.category} ${personName(incident.reporter)} ${incident.visit.site.client.displayName} ${incident.visit.site.name}`.toLowerCase().includes(needle)
    })
  }, [data, incidentFilter, query])

  const runningCount = useMemo(() => data?.visits.filter((visit) => visit.timeEntries.some((entry) => entry.status === 'running')).length ?? 0, [data])
  const attentionCount = useMemo(() => data?.visits.filter(visitNeedsAttention).length ?? 0, [data])

  function switchTab(next: 'live' | 'review' | 'incidents') {
    setTab(next)
    setSelectedReviewKey(null)
    setQuery('')
  }

  return <main className="page-shell field-v2">
    <header className="field-v2-hero">
      <div className="field-v2-hero-copy">
        <span className="field-v2-eyebrow">Live operations</span>
        <h1>Field control</h1>
        <p>Run today&apos;s execution in real time. Timers, GPS, proof and incidents live here; period closing and payroll stay in Timesheets.</p>
      </div>
      <div className="field-v2-hero-actions">
        <span className="field-v2-live"><i />Live sync · 30s</span>
        <a className="field-v2-secondary" href="/timesheets"><OpsIcon name="payroll" />Timesheets</a>
        <button className="field-v2-secondary" onClick={() => void refresh()} disabled={loading}><OpsIcon name="refresh" />Refresh</button>
      </div>
    </header>

    {notice ? <div className={`field-v2-toast ${notice.kind}`} role="status"><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss message">×</button></div> : null}
    {loading ? <section className="field-v2-loading">Connecting to field activity…</section> : null}

    {data ? <>
      <section className="field-v2-metrics" aria-label="Operational summary">
        <button className={tab === 'live' && liveFilter === 'all' ? 'selected' : ''} onClick={() => { switchTab('live'); setLiveFilter('all') }}><span className="field-v2-metric-icon"><OpsIcon name="calendar" /></span><span>Visits today</span><strong>{data.summary.visits}</strong><small>{data.summary.completed} complete · {attentionCount} attention</small></button>
        <button className={`${runningCount ? 'live' : ''} ${tab === 'live' && liveFilter === 'running' ? 'selected' : ''}`} onClick={() => { switchTab('live'); setLiveFilter('running') }}><span className="field-v2-metric-icon"><OpsIcon name="activity" /></span><span>Live now</span><strong>{data.summary.activeTimers}</strong><small>{runningCount} visits with active execution</small></button>
        <button className={`${data.summary.needsReview ? 'review' : ''} ${tab === 'review' ? 'selected' : ''}`} onClick={() => { switchTab('review'); setReviewFilter('all') }}><span className="field-v2-metric-icon"><OpsIcon name="review" /></span><span>Needs review</span><strong>{reviewCases.length}</strong><small>GPS, worker challenge or proof</small></button>
        <button className={`${data.summary.criticalIncidents ? 'critical' : ''} ${tab === 'incidents' ? 'selected' : ''}`} onClick={() => { switchTab('incidents'); setIncidentFilter('all') }}><span className="field-v2-metric-icon"><OpsIcon name="incident" /></span><span>Open incidents</span><strong>{data.summary.openIncidents}</strong><small>{data.summary.criticalIncidents} critical</small></button>
      </section>

      <section className="field-v2-tabs" aria-label="Field control views">
        <div className="field-v2-segmented">
          <button className={tab === 'live' ? 'selected' : ''} onClick={() => switchTab('live')}><OpsIcon name="activity" size={16} />Live board</button>
          <button className={tab === 'review' ? 'selected' : ''} onClick={() => switchTab('review')}><OpsIcon name="review" size={16} />Review queue <span>{reviewCases.length}</span></button>
          <button className={tab === 'incidents' ? 'selected' : ''} onClick={() => switchTab('incidents')}><OpsIcon name="incident" size={16} />Incidents <span>{data.summary.openIncidents}</span></button>
        </div>
        <small>Execution data auto-refreshes every 30 seconds</small>
      </section>

      <section className="field-v2-toolbar">
        <label className="field-v2-search"><OpsIcon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'live' ? 'Search employee, client or site…' : tab === 'review' ? 'Search review queue…' : 'Search incidents…'} /></label>
        {tab === 'live' ? <div className="field-v2-pills">{([
          ['all', 'All visits'], ['running', 'Live now'], ['attention', 'Attention'], ['no_timer', 'No timer'], ['completed', 'Completed'],
        ] as Array<[LiveFilter, string]>).map(([value, label]) => <button key={value} className={liveFilter === value ? 'selected' : ''} onClick={() => setLiveFilter(value)}>{label}</button>)}</div> : null}
        {tab === 'review' ? <div className="field-v2-pills">{([
          ['all', 'All reviews'], ['gps', 'GPS / execution'], ['evidence', 'Evidence'], ['challenge', 'Worker challenge'],
        ] as Array<[ReviewFilter, string]>).map(([value, label]) => <button key={value} className={reviewFilter === value ? 'selected' : ''} onClick={() => { setReviewFilter(value); setSelectedReviewKey(null) }}>{label}</button>)}</div> : null}
        {tab === 'incidents' ? <div className="field-v2-pills">{([
          ['all', 'All open'], ['critical', 'Critical'], ['active', 'Acknowledged / in progress'],
        ] as Array<[IncidentFilter, string]>).map(([value, label]) => <button key={value} className={incidentFilter === value ? 'selected' : ''} onClick={() => setIncidentFilter(value)}>{label}</button>)}</div> : null}
      </section>

      {tab === 'live' ? <section className="field-v2-workspace">
        <div className="field-v2-section-head"><div><h2>Today&apos;s execution</h2><p>{liveFilter === 'running' ? 'Only visits with an active worker timer.' : liveFilter === 'attention' ? 'Execution states that need an operational look.' : 'Every visit scheduled for the operational day.'}</p></div><span>{filteredVisits.length}</span></div>
        <div className="field-v2-visit-list">
          {filteredVisits.map((visit) => {
            const done = visit.taskResults.filter((task) => task.status !== 'pending').length
            const total = visit.taskResults.length
            const active = visit.timeEntries.find((entry) => entry.status === 'running')
            const needsAttention = visitNeedsAttention(visit)
            const executionLabel = visit.status === 'completed' ? 'Completed' : active ? 'On job' : needsAttention ? 'Attention' : 'Awaiting execution'
            return <article className={`field-v2-visit ${active ? 'is-live' : ''} ${needsAttention ? 'needs-attention' : ''}`} key={visit.id}>
              <div className="field-v2-time"><strong>{time(visit.scheduledStart, timezone)}</strong><span>{time(visit.scheduledEnd, timezone)}</span></div>
              <div className="field-v2-visit-main"><div><strong>{visit.site.client.displayName}</strong><span className={`field-v2-status ${active ? 'live' : needsAttention ? 'attention' : visit.status === 'completed' ? 'complete' : 'neutral'}`}>{executionLabel}</span></div><span>{visit.site.name} · {visit.job.name}</span><small>{visit.assignments.map((assignment) => personName(assignment.user)).join(', ') || 'Unassigned'}</small></div>
              <div className="field-v2-progress"><div><span style={{ width: `${total ? done / total * 100 : 0}%` }} /></div><small>{done}/{total || '—'} tasks · {visit._count.evidenceAssets} evidence</small></div>
              <div className="field-v2-execution">{active ? <><span className="field-v2-live-line"><OpsIcon name="activity" size={15} />Timer running</span><strong>{duration(active.durationSeconds, active.startedAt)}</strong><small>{active.startLocationClass === 'verified' ? 'GPS verified at start' : active.startLocationClass === 'near' ? 'GPS watch at start' : active.startLocationClass ? `GPS ${active.startLocationClass}` : 'GPS not available'}</small></> : <><span className="field-v2-muted-line"><OpsIcon name="clock" size={15} />No active timer</span><small>{visit.status === 'completed' ? 'Execution finished' : 'Waiting for worker clock-in'}</small></>}</div>
            </article>
          })}
          {!filteredVisits.length ? <div className="field-v2-empty">No visits match this execution filter.</div> : null}
        </div>
      </section> : null}

      {tab === 'review' ? <section className="field-v2-workspace">
        {!selectedReview ? <>
          <div className="field-v2-section-head"><div><h2>Review queue</h2><p>Only operational exceptions and proof that need a manager decision land here. Clean time moves on to Timesheets.</p></div><span>{filteredReviewCases.length}</span></div>
          <div className="field-v2-review-list">
            {filteredReviewCases.map((caseItem) => {
              if (caseItem.kind === 'evidence') {
                return <button className="field-v2-review-row" key={caseItem.key} onClick={() => setSelectedReviewKey(caseItem.key)}><span className="field-v2-review-icon evidence"><OpsIcon name="review" /></span><span className="field-v2-review-copy"><strong>{caseItem.visit.site.client.displayName}</strong><small>{caseItem.visit.site.name}</small><span>Completed visit proof needs an evidence decision.</span></span><span className="field-v2-review-meta"><strong>{caseItem.visit.evidenceAssets.length} proof</strong><small>{caseItem.visit.taskResults.filter((task) => task.status !== 'pending').length}/{caseItem.visit.taskResults.length} tasks</small></span><span className="field-v2-open">Review →</span></button>
              }
              const openChallenge = caseItem.entry.disputes?.[0]
              const clockIn = caseItem.entry.locationEvents.find((event) => event.kind === 'clock_in')
              return <button className="field-v2-review-row" key={caseItem.key} onClick={() => setSelectedReviewKey(caseItem.key)}><span className={`field-v2-review-icon ${openChallenge ? 'challenge' : locationTone(clockIn)}`}><OpsIcon name={openChallenge ? 'alert' : 'field'} /></span><span className="field-v2-review-copy"><strong>{personName(caseItem.entry.user)}</strong><small>{caseItem.entry.visit ? `${caseItem.entry.visit.site.client.displayName} · ${caseItem.entry.visit.site.name}` : 'Non-visit time'}</small><span>{openChallenge ? 'Worker correction request is open.' : friendlyReviewReason(caseItem.entry.reviewReason)}</span></span><span className="field-v2-review-meta"><strong>{duration(caseItem.entry.durationSeconds, caseItem.entry.startedAt)}</strong><small>{openChallenge ? 'Challenge' : locationLabel(clockIn)}</small></span><span className="field-v2-open">Review →</span></button>
            })}
            {!filteredReviewCases.length ? <div className="field-v2-empty">No operational reviews match this filter.</div> : null}
          </div>
        </> : selectedReview.kind === 'time' ? <TimeReviewDetail entry={selectedReview.entry} timezone={timezone} notes={notes} setNotes={setNotes} busyId={busyId} onBack={() => setSelectedReviewKey(null)} onReview={review} onResolveDispute={resolveDispute} /> : <EvidenceReviewDetail visit={selectedReview.visit} notes={notes} setNotes={setNotes} busyId={busyId} onBack={() => setSelectedReviewKey(null)} onReview={reviewVisit} />}
      </section> : null}

      {tab === 'incidents' ? <section className="field-v2-workspace">
        <div className="field-v2-section-head"><div><h2>Open incidents</h2><p>Safety, access, damage, equipment and client issues that are still operationally active.</p></div><span>{filteredIncidents.length}</span></div>
        <div className="field-v2-incident-list">
          {filteredIncidents.map((incident) => <article className={`field-v2-incident ${incident.severity === 'critical' ? 'critical' : ''}`} key={incident.id} data-incident-id={incident.id}>
            <div className="field-v2-incident-head"><span className={`field-v2-incident-icon ${incident.severity}`}><OpsIcon name="incident" /></span><div><strong>{incident.title}</strong><small>{incident.category} · {incident.severity}</small></div><span className="field-v2-status attention">{incident.status.replaceAll('_', ' ')}</span></div>
            <p>{incident.description || 'No additional description.'}</p>
            <div className="field-v2-incident-meta"><span>{incident.visit.site.client.displayName} · {incident.visit.site.name}</span><span>Reported by {personName(incident.reporter)} · {dateTime(incident.createdAt, timezone)}</span></div>
            <label className="field-v2-note"><span>Manager note</span><input value={notes[incident.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [incident.id]: event.target.value }))} placeholder="Optional resolution or handoff note" /></label>
            <div className="field-v2-actions"><button className="field-v2-secondary" disabled={busyId === incident.id} onClick={() => void updateIncident(incident.id, 'acknowledged')}>Acknowledge</button><button className="field-v2-secondary" disabled={busyId === incident.id} onClick={() => void updateIncident(incident.id, 'in_progress')}>Mark in progress</button><button className="field-v2-primary" disabled={busyId === incident.id} onClick={() => void updateIncident(incident.id, 'resolved')}>Resolve</button></div>
          </article>)}
          {!filteredIncidents.length ? <div className="field-v2-empty">No incidents match this filter.</div> : null}
        </div>
      </section> : null}
    </> : null}
  </main>
}

function TimeReviewDetail({
  entry,
  timezone,
  notes,
  setNotes,
  busyId,
  onBack,
  onReview,
  onResolveDispute,
}: {
  entry: TimeEntry
  timezone: string
  notes: Record<string, string>
  setNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>
  busyId: string | null
  onBack(): void
  onReview(entryId: string, decision: 'approved' | 'rejected'): Promise<void>
  onResolveDispute(disputeId: string, decision: 'accepted' | 'declined'): Promise<void>
}) {
  const clockIn = entry.locationEvents.find((event) => event.kind === 'clock_in')
  const clockOut = [...entry.locationEvents].reverse().find((event) => event.kind === 'clock_out')
  const openChallenge = entry.disputes?.[0]

  return <article className="field-v2-review-detail">
    <header className="field-v2-detail-head"><button className="field-v2-back" onClick={onBack}>← Review queue</button><a className="field-v2-secondary" href={`/timesheets?entry=${encodeURIComponent(entry.id)}`}><OpsIcon name="clock" size={16} />Open timesheet</a></header>
    <div className="field-v2-detail-title"><span className="field-v2-eyebrow">Execution review</span><h2>{personName(entry.user)}</h2><p>{entry.visit ? `${entry.visit.site.client.displayName} · ${entry.visit.site.name}` : 'Non-visit time'} · started {dateTime(entry.startedAt, timezone)}</p></div>
    <section className="field-v2-explanation"><OpsIcon name="alert" /><div><strong>Why this needs review</strong><span>{openChallenge ? 'The worker has asked Operations to correct or reconsider this time entry.' : friendlyReviewReason(entry.reviewReason)}</span></div></section>
    <section className="field-v2-location-grid">
      <LocationCheck title="Clock in" point={clockIn} />
      <LocationCheck title="Clock out" point={clockOut} />
    </section>
    {entry.locationEvents.length ? <section className="field-v2-timeline"><h3>Location timeline</h3>{entry.locationEvents.map((point) => <div key={point.id}><span className={`field-v2-timeline-dot ${locationTone(point)}`} /><div><strong>{point.kind.replaceAll('_', ' ')}</strong><small>{dateTime(point.capturedAt, timezone)} · {locationMeta(point)}</small></div><span>{locationLabel(point)}</span></div>)}</section> : null}
    {openChallenge ? <section className="field-v2-worker-request"><div><OpsIcon name="user" /><strong>Worker correction request</strong></div><p>{openChallenge.reason}</p><label className="field-v2-note"><span>Response to worker</span><input value={notes[openChallenge.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [openChallenge.id]: event.target.value }))} placeholder="Explain the decision" /></label><div className="field-v2-actions"><button className="field-v2-secondary" disabled={busyId === openChallenge.id} onClick={() => void onResolveDispute(openChallenge.id, 'declined')}>Keep original</button><button className="field-v2-primary" disabled={busyId === openChallenge.id} onClick={() => void onResolveDispute(openChallenge.id, 'accepted')}>Accept correction</button></div></section> : null}
    <section className="field-v2-decision"><label className="field-v2-note"><span>Manager decision note</span><input value={notes[entry.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [entry.id]: event.target.value }))} placeholder="Optional when approving; explain when returning" /></label><div className="field-v2-actions"><button className="field-v2-secondary danger" disabled={busyId === entry.id} onClick={() => void onReview(entry.id, 'rejected')}>Return for correction</button><button className="field-v2-primary" disabled={busyId === entry.id} onClick={() => void onReview(entry.id, 'approved')}>Approve execution record</button></div></section>
  </article>
}

function LocationCheck({ title, point }: { title: string; point: LocationEvent | undefined }) {
  return <div data-tone={locationTone(point)}><header><strong>{title}</strong><span>{locationLabel(point)}</span></header><b>{point?.distanceM == null ? 'No distance' : `${point.distanceM}m`}</b><small>{point ? locationMeta(point) : 'No location captured'}</small></div>
}

function EvidenceReviewDetail({
  visit,
  notes,
  setNotes,
  busyId,
  onBack,
  onReview,
}: {
  visit: VisitReviewCandidate
  notes: Record<string, string>
  setNotes: React.Dispatch<React.SetStateAction<Record<string, string>>>
  busyId: string | null
  onBack(): void
  onReview(visitId: string, decision: 'approved' | 'rework_requested'): Promise<void>
}) {
  const recordedTasks = visit.taskResults.filter((task) => task.status !== 'pending').length
  const openIncidents = visit.incidents.filter((incident) => !['resolved', 'closed'].includes(incident.status)).length
  return <article className="field-v2-review-detail">
    <header className="field-v2-detail-head"><button className="field-v2-back" onClick={onBack}>← Review queue</button></header>
    <div className="field-v2-detail-title"><span className="field-v2-eyebrow">Evidence review</span><h2>{visit.site.client.displayName}</h2><p>{visit.site.name}</p></div>
    <section className="field-v2-evidence-grid"><div><strong>{recordedTasks}/{visit.taskResults.length}</strong><span>tasks recorded</span></div><div><strong>{visit.evidenceAssets.length}</strong><span>proof items</span></div><div><strong>{openIncidents}</strong><span>open incidents</span></div></section>
    <section className="field-v2-explanation evidence"><OpsIcon name="review" /><div><strong>Proof decision</strong><span>Confirm that the completed work and submitted evidence are sufficient. Rework keeps the original completion record and sends clear instructions back to the field team.</span></div></section>
    <section className="field-v2-decision"><label className="field-v2-note"><span>Supervisor decision note</span><input value={notes[visit.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [visit.id]: event.target.value }))} placeholder="Required when asking for rework" /></label><div className="field-v2-actions"><button className="field-v2-secondary danger" disabled={busyId === visit.id} onClick={() => void onReview(visit.id, 'rework_requested')}>Send for rework</button><button className="field-v2-primary" disabled={busyId === visit.id} onClick={() => void onReview(visit.id, 'approved')}>Approve evidence</button></div></section>
  </article>
}
