'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { formatOperationalDateTime } from '../../lib/operational-time'
import { clientApi } from '../../lib/client-api'
import OpsIcon from '../ui/OpsIcon'
import StandardSelect from '../ui/StandardSelect'
import './TimesheetsWorkspace.css'

type Entry = {
  id: string
  kind: string
  status: string
  startedAt: string
  endedAt?: string | null
  durationSeconds?: number | null
  payableSeconds?: number | null
  reviewReason?: string | null
  user: { id: string; name?: string | null; email: string }
  visit?: {
    id: string
    status: string
    site: { id: string; name: string; client: { id: string; displayName: string } }
  } | null
  locationEvents?: Array<{ id: string; kind: string; classification?: string | null; distanceM?: number | null; accuracyM?: number | null }>
  locationSummary?: { count: number; maxDistanceM: number | null; needsReview: boolean }
  disputes: Array<{ id: string; reason?: string; status: string; resolution?: string | null }>
}

type StatusFilter = 'all' | 'recorded' | 'needs_review' | 'approved' | 'rejected' | 'running' | 'challenge'
type ExportScope = 'filtered' | 'period'
type ExportLayout = 'summary' | 'detailed'

function entryDurationMs(entry: Entry) {
  if (!entry.endedAt) return 0
  if (entry.durationSeconds != null) return Math.max(0, entry.durationSeconds * 1000)
  return Math.max(0, new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime())
}

function payableDurationMs(entry: Entry) {
  if (entry.status !== 'approved') return 0
  const recorded = entryDurationMs(entry)
  return entry.payableSeconds == null ? recorded : Math.min(recorded, Math.max(0, entry.payableSeconds * 1000))
}

function excludedDurationMs(entry: Entry) {
  const recorded = entryDurationMs(entry)
  if (!recorded) return 0
  if (entry.status === 'rejected') return recorded
  if (entry.status === 'approved') return Math.max(0, recorded - payableDurationMs(entry))
  return 0
}

function humanReviewReason(reason?: string | null) {
  if (!reason) return null
  const technical = reason.split(' | ')[0]
  if (technical.includes('PRESENCE_LOCATION_ANOMALY') && technical.includes('LOCATION_FAR_FROM_SITE')) return 'A presence check was captured far from the expected work site.'
  if (technical.includes('PRESENCE_LOCATION_ANOMALY')) return 'A presence check during the visit was outside the expected site area.'
  if (technical.includes('LOCATION_FAR_FROM_SITE')) return 'A GPS check was captured far from the expected work site.'
  if (technical.includes('LOCATION_OUTSIDE_GEOFENCE')) return 'A GPS check was outside the verified site area.'
  if (technical.includes('GPS_UNAVAILABLE')) return 'GPS evidence was unavailable for a required location check.'
  if (technical.includes('GPS_UNCERTAIN')) return 'GPS accuracy was too weak to verify the location confidently.'
  if (technical.includes('REPEATED_LOCATION_PATTERN')) return 'A repeated location pattern needs manager review.'
  return technical.replaceAll('_', ' ').replaceAll(':', ' · ').toLowerCase()
}

function humanDuration(value: number) {
  const minutes = Math.round(value / 60_000)
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

function decimalHours(value: number) {
  return (value / 3_600_000).toFixed(2)
}

function isoDate(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function hasOpenChallenge(entry: Entry) {
  return entry.disputes.some((dispute) => dispute.status === 'open')
}

function hasOperationalException(entry: Entry) {
  return entry.status === 'needs_review' || hasOpenChallenge(entry)
}

function hasLocationReview(entry: Entry) {
  if (entry.locationSummary) return entry.locationSummary.needsReview
  return (entry.locationEvents ?? []).some((event) => ['suspicious', 'outside', 'unavailable'].includes(event.classification ?? ''))
}

function statusLabel(entry: Entry) {
  if (hasOpenChallenge(entry)) return 'Challenge open'
  if (entry.status === 'needs_review') return 'Needs review'
  if (entry.status === 'approved') return 'Approved'
  if (entry.status === 'rejected') return 'Rejected'
  if (entry.status === 'running') return 'Running'
  if (entry.status === 'completed') return 'Recorded'
  return entry.status.replaceAll('_', ' ')
}

function statusClass(entry: Entry) {
  if (hasOpenChallenge(entry)) return 'challenge'
  return entry.status === 'completed' ? 'completed' : entry.status
}

function matchesStatus(entry: Entry, filter: StatusFilter) {
  if (filter === 'all') return true
  if (filter === 'challenge') return hasOpenChallenge(entry)
  if (filter === 'recorded') return entry.status === 'completed'
  return entry.status === filter
}

export default function TimesheetsWorkspace({ canManage }: { canManage: boolean }) {
  const searchParams = useSearchParams()
  const focusedEntryId = searchParams.get('entry')
  const now = useMemo(() => new Date(), [])
  const [entries, setEntries] = useState<Entry[]>([])
  const [tab, setTab] = useState<'review' | 'payroll'>('review')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState(isoDate(new Date(now.getTime() - 29 * 86_400_000)))
  const [to, setTo] = useState(isoDate(now))
  const [employeeFilter, setEmployeeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [exportOpen, setExportOpen] = useState(false)
  const [exportScope, setExportScope] = useState<ExportScope>('filtered')
  const [exportLayout, setExportLayout] = useState<ExportLayout>('summary')
  const [reviewingEntry, setReviewingEntry] = useState<Entry | null>(null)
  const [reviewMode, setReviewMode] = useState<'full' | 'adjusted' | 'reject'>('full')
  const [payableHours, setPayableHours] = useState('0')
  const [payableMinutes, setPayableMinutes] = useState('0')
  const [reviewNote, setReviewNote] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', `${from}T00:00:00.000Z`)
      if (to) params.set('to', `${to}T23:59:59.999Z`)
      setEntries(await clientApi<Entry[]>(`/api/time-entries?${params}`, undefined, 'Could not load timesheets'))
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load timesheets.' })
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 120)
    return () => window.clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    if (!notice || notice.kind === 'error') return
    const timer = window.setTimeout(() => setNotice(null), 3600)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!focusedEntryId) return
    setTab('review')
    setEmployeeFilter('all')
    setStatusFilter('all')
    setKindFilter('all')
    setClientFilter('all')
    setQuery('')
  }, [focusedEntryId])

  const reviewEntry = useCallback(async (entry: Entry, decision: 'approved' | 'rejected', payableSeconds: number, note: string) => {
    setBusyId(entry.id)
    try {
      await clientApi(`/api/time-entries/${entry.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, payableSeconds, note: note.trim() || null }),
      }, 'Could not review this entry')
      const recordedSeconds = Math.round(entryDurationMs(entry) / 1000)
      const excludedSeconds = Math.max(0, recordedSeconds - payableSeconds)
      setNotice({
        kind: 'success',
        text: decision === 'rejected'
          ? `Payroll decision saved · ${humanDuration(recordedSeconds * 1000)} excluded.`
          : excludedSeconds
            ? `Payroll decision saved · ${humanDuration(payableSeconds * 1000)} payable, ${humanDuration(excludedSeconds * 1000)} excluded.`
            : 'Payroll decision saved · full recorded time is payable.',
      })
      setReviewingEntry(null)
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not review this entry.' })
    } finally {
      setBusyId(null)
    }
  }, [refresh])

  function openPayrollReview(entry: Entry) {
    const recordedMinutes = Math.round(entryDurationMs(entry) / 60_000)
    const currentPayableMinutes = entry.status === 'approved'
      ? Math.round(payableDurationMs(entry) / 60_000)
      : recordedMinutes
    setReviewingEntry(entry)
    setReviewMode(currentPayableMinutes === recordedMinutes ? 'full' : 'adjusted')
    setPayableHours(String(Math.floor(currentPayableMinutes / 60)))
    setPayableMinutes(String(currentPayableMinutes % 60))
    setReviewNote('')
  }

  function submitPayrollReview() {
    if (!reviewingEntry) return
    const recordedSeconds = Math.round(entryDurationMs(reviewingEntry) / 1000)
    const requestedMinutes = Math.max(0, Number.parseInt(payableHours || '0', 10) * 60 + Number.parseInt(payableMinutes || '0', 10))
    const requestedSeconds = reviewMode === 'full' ? recordedSeconds : reviewMode === 'reject' ? 0 : Math.min(recordedSeconds, requestedMinutes * 60)
    if ((reviewMode === 'adjusted' || reviewMode === 'reject') && !reviewNote.trim()) {
      setNotice({ kind: 'error', text: 'Add a reason for a payroll adjustment or rejection.' })
      return
    }
    void reviewEntry(reviewingEntry, reviewMode === 'reject' ? 'rejected' : 'approved', requestedSeconds, reviewNote)
  }

  const employeeOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of entries) map.set(entry.user.id, entry.user.name || entry.user.email)
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [entries])

  const kindOptions = useMemo(() => [...new Set(entries.map((entry) => entry.kind))].sort(), [entries])

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of entries) {
      if (entry.visit) map.set(entry.visit.site.client.id, entry.visit.site.client.displayName)
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [entries])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (employeeFilter !== 'all' && entry.user.id !== employeeFilter) return false
      if (kindFilter !== 'all' && entry.kind !== kindFilter) return false
      if (clientFilter !== 'all' && entry.visit?.site.client.id !== clientFilter) return false
      if (!matchesStatus(entry, statusFilter)) return false
      if (!needle) return true
      const searchable = [
        entry.id,
        entry.user.name,
        entry.user.email,
        entry.kind,
        entry.visit?.site.name,
        entry.visit?.site.client.displayName,
        entry.reviewReason,
      ].filter(Boolean).join(' ').toLowerCase()
      return searchable.includes(needle)
    })
  }, [clientFilter, employeeFilter, entries, kindFilter, query, statusFilter])

  const metrics = useMemo(() => {
    const ended = filtered.filter((entry) => Boolean(entry.endedAt))
    const recordedMs = ended.reduce((sum, entry) => sum + entryDurationMs(entry), 0)
    const approved = ended.filter((entry) => entry.status === 'approved')
    const pending = ended.filter((entry) => entry.status === 'completed' || entry.status === 'needs_review')
    const challenges = filtered.filter(hasOpenChallenge)
    const reviewRequired = filtered.filter(hasOperationalException)
    return {
      recordedMs,
      approvedMs: approved.reduce((sum, entry) => sum + payableDurationMs(entry), 0),
      excludedMs: ended.reduce((sum, entry) => sum + excludedDurationMs(entry), 0),
      pendingMs: pending.reduce((sum, entry) => sum + entryDurationMs(entry), 0),
      pendingCount: pending.length,
      blockedCount: filtered.filter((entry) => entry.status === 'completed' || hasOperationalException(entry)).length,
      challengeCount: challenges.length,
      reviewCount: reviewRequired.length,
      runningCount: filtered.filter((entry) => entry.status === 'running').length,
    }
  }, [filtered])

  const reviewQueueCount = useMemo(
    () => entries.filter((entry) => entry.status === 'completed' || hasOperationalException(entry)).length,
    [entries],
  )

  const payrollRows = useMemo(() => {
    const groups = new Map<string, {
      user: Entry['user']
      entries: number
      recordedMs: number
      approvedMs: number
      excludedMs: number
      pendingMs: number
      challenges: number
      needsReview: number
      exceptions: number
      running: number
    }>()
    for (const entry of filtered) {
      const group = groups.get(entry.user.id) ?? {
        user: entry.user,
        entries: 0,
        recordedMs: 0,
        approvedMs: 0,
        excludedMs: 0,
        pendingMs: 0,
        challenges: 0,
        needsReview: 0,
        exceptions: 0,
        running: 0,
      }
      group.entries += 1
      const ms = entryDurationMs(entry)
      if (entry.endedAt) group.recordedMs += ms
      if (entry.status === 'approved') group.approvedMs += payableDurationMs(entry)
      group.excludedMs += excludedDurationMs(entry)
      if (entry.status === 'completed' || entry.status === 'needs_review') group.pendingMs += ms
      if (hasOpenChallenge(entry)) group.challenges += 1
      if (entry.status === 'needs_review') group.needsReview += 1
      if (hasOperationalException(entry)) group.exceptions += 1
      if (entry.status === 'running') group.running += 1
      groups.set(entry.user.id, group)
    }
    return [...groups.values()].sort((a, b) => (a.user.name || a.user.email).localeCompare(b.user.name || b.user.email))
  }, [filtered])

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = []
    if (employeeFilter !== 'all') labels.push(employeeOptions.find(([id]) => id === employeeFilter)?.[1] ?? 'Employee')
    if (statusFilter !== 'all') labels.push(statusFilter === 'recorded' ? 'Recorded' : statusFilter.replaceAll('_', ' '))
    if (kindFilter !== 'all') labels.push(kindFilter.replaceAll('_', ' '))
    if (clientFilter !== 'all') labels.push(clientOptions.find(([id]) => id === clientFilter)?.[1] ?? 'Client')
    if (query.trim()) labels.push(`Search: ${query.trim()}`)
    return labels
  }, [clientFilter, clientOptions, employeeFilter, employeeOptions, kindFilter, query, statusFilter])

  function clearFilters() {
    setQuery('')
    setEmployeeFilter('all')
    setStatusFilter('all')
    setKindFilter('all')
    setClientFilter('all')
  }

  function exportTimesheets() {
    const source = exportScope === 'filtered' ? filtered : entries
    const periodSlug = `${from || 'start'}-to-${to || 'today'}`
    if (exportLayout === 'detailed') {
      const rows: unknown[][] = [[
        'Date', 'Employee', 'Email', 'Work type', 'Client', 'Site', 'Start', 'End', 'Duration hours',
        'Review status', 'Payable hours', 'Excluded hours', 'Open challenge', 'Location signal', 'Maximum distance (m)',
      ]]
      for (const entry of source) {
        const maxDistance = entry.locationSummary?.maxDistanceM
          ?? (entry.locationEvents ?? []).reduce<number | null>((max, event) => {
            if (event.distanceM == null) return max
            return max == null ? event.distanceM : Math.max(max, event.distanceM)
          }, null)
        rows.push([
          entry.startedAt.slice(0, 10),
          entry.user.name || entry.user.email,
          entry.user.email,
          entry.kind.replaceAll('_', ' '),
          entry.visit?.site.client.displayName ?? '',
          entry.visit?.site.name ?? 'General / non-visit time',
          entry.startedAt,
          entry.endedAt ?? '',
          entry.endedAt ? decimalHours(entryDurationMs(entry)) : '',
          statusLabel(entry),
          decimalHours(payableDurationMs(entry)),
          decimalHours(excludedDurationMs(entry)),
          hasOpenChallenge(entry) ? 'Yes' : 'No',
          hasLocationReview(entry) ? 'Review' : (entry.locationSummary?.count ?? entry.locationEvents?.length ?? 0) ? 'OK / watch' : 'No location evidence',
          maxDistance ?? '',
        ])
      }
      downloadCsv(`diamond-shine-timesheets-${periodSlug}.csv`, rows)
    } else {
      const groups = new Map<string, {
        user: Entry['user']
        entries: number
        recordedMs: number
        approvedMs: number
        excludedMs: number
        pendingMs: number
        challengeCount: number
        reviewCount: number
        exceptionCount: number
        runningCount: number
      }>()
      for (const entry of source) {
        const current = groups.get(entry.user.id) ?? {
          user: entry.user,
          entries: 0,
          recordedMs: 0,
          approvedMs: 0,
          excludedMs: 0,
          pendingMs: 0,
          challengeCount: 0,
          reviewCount: 0,
          exceptionCount: 0,
          runningCount: 0,
        }
        current.entries += 1
        const ms = entryDurationMs(entry)
        if (entry.endedAt) current.recordedMs += ms
        if (entry.status === 'approved') current.approvedMs += payableDurationMs(entry)
        current.excludedMs += excludedDurationMs(entry)
        if (entry.status === 'completed' || entry.status === 'needs_review') current.pendingMs += ms
        if (hasOpenChallenge(entry)) current.challengeCount += 1
        if (entry.status === 'needs_review') current.reviewCount += 1
        if (hasOperationalException(entry)) current.exceptionCount += 1
        if (entry.status === 'running') current.runningCount += 1
        groups.set(entry.user.id, current)
      }
      const rows: unknown[][] = [[
        'Employee', 'Email', 'Recorded hours', 'Payable hours', 'Excluded hours', 'Pending hours',
        'Operational exceptions', 'Challenges', 'Needs review', 'Running timers', 'Entries',
      ]]
      for (const group of [...groups.values()].sort((a, b) => (a.user.name || a.user.email).localeCompare(b.user.name || b.user.email))) {
        rows.push([
          group.user.name || group.user.email,
          group.user.email,
          decimalHours(group.recordedMs),
          decimalHours(group.approvedMs),
          decimalHours(group.excludedMs),
          decimalHours(group.pendingMs),
          group.exceptionCount,
          group.challengeCount,
          group.reviewCount,
          group.runningCount,
          group.entries,
        ])
      }
      downloadCsv(`diamond-shine-payroll-summary-${periodSlug}.csv`, rows)
    }
    setExportOpen(false)
    setNotice({ kind: 'success', text: 'Export downloaded. The CSV opens directly in Excel and accounting software.' })
  }

  return <main className="page-shell manager-page timesheets-v2">
    <header className="ts-hero">
      <div className="ts-hero-copy">
        <span className="ts-eyebrow">Workforce control</span>
        <h1>Timesheets</h1>
        <p>{canManage ? 'Close a period with confidence: review recorded time, resolve exceptions, see payroll-ready hours and export exactly what accounting needs.' : 'Review your recorded time and the status of each work session.'}</p>
      </div>
      <div className="ts-hero-actions">
        {canManage ? <a href="/field-control" className="ts-button-secondary"><OpsIcon name="field" />Field control</a> : null}
        <button className="ts-button" onClick={() => setExportOpen(true)}><OpsIcon name="download" />Export</button>
      </div>
    </header>

    <nav className="ts-tabs" aria-label="Timesheet sections">
      <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}><OpsIcon name="review" size={16} />{canManage ? 'Review time' : 'My time'}<small>{reviewQueueCount}</small></button>
      {canManage ? <button className={tab === 'payroll' ? 'active' : ''} onClick={() => setTab('payroll')}><OpsIcon name="payroll" size={16} />Payroll preview</button> : null}
    </nav>

    {notice ? <div className={`ts-toast ${notice.kind === 'error' ? 'error' : ''}`} role="status"><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss message">×</button></div> : null}

    <section className="ts-period">
      <div className="ts-period-copy">
        <span className="ts-eyebrow">Review period</span>
        <strong>{from || 'Start'} → {to || 'Today'}</strong>
        <small>Metrics, payroll preview and exports all use this same period.</small>
      </div>
      <div className="ts-period-controls">
        <label className="ts-field"><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="ts-field"><span>To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
    </section>

    <section className="ts-metrics" aria-label="Timesheet summary">
      <article className="ts-metric"><span className="ts-metric-icon"><OpsIcon name="clock" /></span><span>Recorded hours</span><strong>{humanDuration(metrics.recordedMs)}</strong><small>{filtered.filter((entry) => Boolean(entry.endedAt)).length} ended entries</small></article>
      <article className="ts-metric approved"><span className="ts-metric-icon"><OpsIcon name="check" /></span><span>Approved hours</span><strong>{humanDuration(metrics.approvedMs)}</strong><small>Already reviewed</small></article>
      <article className="ts-metric pending"><span className="ts-metric-icon"><OpsIcon name="review" /></span><span>Awaiting approval</span><strong>{humanDuration(metrics.pendingMs)}</strong><small>{metrics.pendingCount} entries</small></article>
      <article className="ts-metric challenge"><span className="ts-metric-icon"><OpsIcon name="alert" /></span><span>Challenges</span><strong>{metrics.challengeCount}</strong><small>{metrics.reviewCount} unique operational exceptions</small></article>
      <article className="ts-metric running"><span className="ts-metric-icon"><OpsIcon name="activity" /></span><span>Running timers</span><strong>{metrics.runningCount}</strong><small>Not payroll-ready yet</small></article>
      <article className="ts-metric excluded"><span className="ts-metric-icon"><OpsIcon name="filter" /></span><span>Excluded</span><strong>{humanDuration(metrics.excludedMs)}</strong><small>Final payroll deductions</small></article>
      <article className="ts-metric ready"><span className="ts-metric-icon"><OpsIcon name="payroll" /></span><span>Payroll ready</span><strong>{humanDuration(metrics.approvedMs)}</strong><small>Approved payable time only</small></article>
    </section>

    <section className="ts-filterbar" aria-label="Timesheet filters">
      <div className="ts-search"><OpsIcon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employee, site or work…" /></div>
      <div className="ts-field"><span>Employee</span><StandardSelect searchable value={employeeFilter} onChange={setEmployeeFilter} ariaLabel="Employee" searchPlaceholder="Search employee…" options={[{ value: 'all', label: 'All employees' }, ...employeeOptions.map(([id, label]) => ({ value: id, label }))]} /></div>
      <div className="ts-field"><span>Status</span><StandardSelect value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)} ariaLabel="Timesheet status" options={[{ value: 'all', label: 'All statuses' }, { value: 'recorded', label: 'Recorded' }, { value: 'needs_review', label: 'Needs review' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'running', label: 'Running' }, { value: 'challenge', label: 'Challenge open' }]} /></div>
      <div className="ts-field"><span>Work type</span><StandardSelect value={kindFilter} onChange={setKindFilter} ariaLabel="Work type" options={[{ value: 'all', label: 'All work types' }, ...kindOptions.map((kind) => ({ value: kind, label: kind.replaceAll('_', ' ') }))]} /></div>
      <div className="ts-field"><span>Client</span><StandardSelect searchable value={clientFilter} onChange={setClientFilter} ariaLabel="Client" searchPlaceholder="Search client…" options={[{ value: 'all', label: 'All clients' }, ...clientOptions.map(([id, label]) => ({ value: id, label }))]} /></div>
      <button className="ts-clear" onClick={clearFilters} disabled={!activeFilterLabels.length}>Clear filters</button>
    </section>

    <div className="ts-filter-summary">
      <span>Showing {filtered.length} of {entries.length} entries</span>
      {activeFilterLabels.map((label) => <span className="ts-chip" key={label}>{label}</span>)}
    </div>

    {tab === 'review' ? <section className="ts-panel">
      <div className="ts-panel-head">
        <div><h2>{canManage ? 'Time review' : 'Recorded time'}</h2><p>{canManage ? 'Clean recorded time can be approved here. GPS, evidence or worker challenges stay connected to Field Control for operational review.' : 'Your work sessions for the selected period.'}</p></div>
        <span className="ts-panel-meta">{loading ? 'Refreshing…' : `${filtered.length} entries`}</span>
      </div>
      <div className="ts-table">
        <div className="ts-head"><span>Employee</span><span>Work</span><span>Type</span><span>Start</span><span>Duration</span><span>Review</span></div>
        {filtered.map((entry) => {
          const operationalException = hasOperationalException(entry)
          return <div className={`ts-row ${focusedEntryId === entry.id ? 'is-focused' : ''}`} key={entry.id}>
            <span className="ts-person"><strong>{entry.user.name || entry.user.email}</strong><small>{entry.user.email}</small></span>
            <span className="ts-work"><strong>{entry.visit ? `${entry.visit.site.client.displayName} · ${entry.visit.site.name}` : 'General / non-visit time'}</strong><small>{humanReviewReason(entry.reviewReason) ?? (entry.visit ? 'Visit work' : 'Non-visit work')}</small></span>
            <span className="ts-kind">{entry.kind.replaceAll('_', ' ')}</span>
            <span>{formatOperationalDateTime(entry.startedAt)}</span>
            <span>{entry.endedAt ? humanDuration(entryDurationMs(entry)) : 'Running'}</span>
            <span className="ts-actions">
              <span className={`ts-status ${statusClass(entry)}`}>{statusLabel(entry)}</span>
              {canManage && operationalException ? <a className="ts-text-action" href={`/field-control?entry=${encodeURIComponent(entry.id)}`}><OpsIcon name="field" size={14} /> Field context</a> : null}
              {canManage && entry.status === 'completed' && !operationalException ? <button disabled={busyId === entry.id} className="ts-text-action" onClick={() => openPayrollReview(entry)}><OpsIcon name="payroll" size={14} /> Review payroll</button> : null}
              {canManage && entry.status === 'approved' ? <button disabled={busyId === entry.id} className="ts-text-action" onClick={() => openPayrollReview(entry)}><OpsIcon name="review" size={14} /> Adjust payroll</button> : null}
            </span>
          </div>
        })}
        {!loading && !filtered.length ? <div className="ts-empty">No time entries match this period and filter.</div> : null}
      </div>
    </section> : null}

    {tab === 'payroll' && canManage ? <section className="ts-payroll-grid">
      <div className="ts-payroll-summary">
        <article className="ts-payroll-card"><span>Employees in view</span><strong>{payrollRows.length}</strong><small>The table below follows the active filters.</small></article>
        <article className="ts-payroll-card"><span>Payroll-ready hours</span><strong>{humanDuration(metrics.approvedMs)}</strong><small>Only approved payable time is included.</small></article>
        <article className="ts-payroll-card"><span>Excluded from payroll</span><strong>{humanDuration(metrics.excludedMs)}</strong><small>Rejected time plus approved adjustments.</small></article>
        <article className="ts-payroll-card"><span>Still blocked</span><strong>{metrics.blockedCount}</strong><small>Entries awaiting approval or operational resolution.</small></article>
      </div>
      <div className="ts-payroll-list">
        <div className="ts-payroll-head"><span>Employee</span><span>Recorded</span><span>Payable</span><span>Excluded</span><span>Pending</span><span>Exceptions</span><span>Running</span></div>
        {payrollRows.map((row) => <div className="ts-payroll-row" key={row.user.id}><strong>{row.user.name || row.user.email}</strong><span>{humanDuration(row.recordedMs)}</span><span>{humanDuration(row.approvedMs)}</span><span>{humanDuration(row.excludedMs)}</span><span>{humanDuration(row.pendingMs)}</span><span>{row.exceptions}</span><span>{row.running}</span></div>)}
        {!payrollRows.length ? <div className="ts-empty">No payroll rows match this filter.</div> : null}
      </div>
    </section> : null}

    {reviewingEntry ? <div className="ts-review-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId) setReviewingEntry(null) }}>
      <section className="ts-review-dialog" role="dialog" aria-modal="true" aria-labelledby="payroll-review-title">
        <header className="ts-review-head">
          <div><span className="ts-eyebrow">Payroll decision</span><h2 id="payroll-review-title">{reviewingEntry.user.name || reviewingEntry.user.email}</h2><p>{reviewingEntry.visit ? `${reviewingEntry.visit.site.client.displayName} · ${reviewingEntry.visit.site.name}` : 'General / non-visit time'}</p></div>
          <button type="button" className="ts-close" onClick={() => setReviewingEntry(null)} disabled={Boolean(busyId)} aria-label="Close payroll review">×</button>
        </header>
        <div className="ts-review-facts">
          <article><span>Recorded</span><strong>{humanDuration(entryDurationMs(reviewingEntry))}</strong><small>Original clock record · never overwritten</small></article>
          <article><span>Current payable</span><strong>{reviewingEntry.status === 'approved' ? humanDuration(payableDurationMs(reviewingEntry)) : 'Not approved'}</strong><small>{reviewingEntry.status === 'approved' ? 'Already payroll-ready' : '0h enters payroll until reviewed'}</small></article>
        </div>
        <div className="ts-review-modes" role="group" aria-label="Payroll decision">
          <button type="button" className={reviewMode === 'full' ? 'selected' : ''} onClick={() => setReviewMode('full')}><OpsIcon name="check" /><strong>Approve full</strong><small>Pay the full recorded duration.</small></button>
          <button type="button" className={reviewMode === 'adjusted' ? 'selected' : ''} onClick={() => setReviewMode('adjusted')}><OpsIcon name="review" /><strong>Adjust & approve</strong><small>Choose the time that should be paid.</small></button>
          <button type="button" className={reviewMode === 'reject' ? 'selected danger' : 'danger'} onClick={() => setReviewMode('reject')}><OpsIcon name="alert" /><strong>Reject all</strong><small>None of this entry enters payroll.</small></button>
        </div>
        {reviewMode === 'adjusted' ? <fieldset className="ts-payable-editor"><legend>Payable time</legend><label><span>Hours</span><input type="number" min="0" max="24" value={payableHours} onChange={(event) => setPayableHours(event.target.value)} /></label><label><span>Minutes</span><input type="number" min="0" max="59" value={payableMinutes} onChange={(event) => setPayableMinutes(event.target.value)} /></label><small>Cannot exceed {humanDuration(entryDurationMs(reviewingEntry))} recorded.</small></fieldset> : null}
        <label className="ts-review-note"><span>{reviewMode === 'full' ? 'Decision note (optional)' : 'Reason (required)'}</span><textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder={reviewMode === 'adjusted' ? 'Explain why part of the recorded time is excluded…' : reviewMode === 'reject' ? 'Explain why this entire entry is excluded from payroll…' : 'Optional payroll note…'} /></label>
        <div className="ts-review-preview">
          <span>Payroll effect</span>
          <strong>{reviewMode === 'reject' ? '0h payable' : reviewMode === 'full' ? `${humanDuration(entryDurationMs(reviewingEntry))} payable` : `${humanDuration(Math.min(entryDurationMs(reviewingEntry), Math.max(0, (Number.parseInt(payableHours || '0', 10) * 60 + Number.parseInt(payableMinutes || '0', 10)) * 60_000)))} payable`}</strong>
          <small>Recorded time stays unchanged for audit.</small>
        </div>
        <footer className="ts-review-actions"><button type="button" className="ts-button-secondary" onClick={() => setReviewingEntry(null)} disabled={Boolean(busyId)}>Cancel</button><button type="button" className="ts-button" onClick={submitPayrollReview} disabled={Boolean(busyId)}>{busyId ? 'Saving…' : 'Save payroll decision'}</button></footer>
      </section>
    </div> : null}

    {exportOpen ? <div className="ts-export-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExportOpen(false) }}>
      <section className="ts-export-dialog" role="dialog" aria-modal="true" aria-labelledby="timesheet-export-title">
        <div className="ts-export-head"><div><h2 id="timesheet-export-title">Export timesheets</h2><p>Create an accounting-friendly CSV that opens directly in Excel. No hidden rows or different calculation rules.</p></div><button className="ts-close" onClick={() => setExportOpen(false)} aria-label="Close export">×</button></div>
        <div className="ts-export-options">
          <div className="ts-option-group"><span>Scope</span><div className="ts-option-row"><button className={`ts-option ${exportScope === 'filtered' ? 'selected' : ''}`} onClick={() => setExportScope('filtered')}><strong>Current filtered view</strong><small>{filtered.length} entries · respects employee, status, work type and client filters.</small></button><button className={`ts-option ${exportScope === 'period' ? 'selected' : ''}`} onClick={() => setExportScope('period')}><strong>Full review period</strong><small>{entries.length} entries · ignores list filters but keeps {from || 'start'} → {to || 'today'}.</small></button></div></div>
          <div className="ts-option-group"><span>Layout</span><div className="ts-option-row"><button className={`ts-option ${exportLayout === 'summary' ? 'selected' : ''}`} onClick={() => setExportLayout('summary')}><strong>Payroll summary</strong><small>One row per employee with recorded, approved and pending hours.</small></button><button className={`ts-option ${exportLayout === 'detailed' ? 'selected' : ''}`} onClick={() => setExportLayout('detailed')}><strong>Detailed entries</strong><small>One row per time entry with site, duration, status, challenge and GPS signal.</small></button></div></div>
        </div>
        <div className="ts-export-footer"><small>Format: UTF-8 CSV · compatible with Excel, Numbers and common payroll/accounting tools.</small><div><button className="ts-button-secondary" onClick={() => setExportOpen(false)}>Cancel</button><button className="ts-button" onClick={exportTimesheets}><OpsIcon name="spreadsheet" />Download CSV</button></div></div>
      </section>
    </div> : null}
  </main>
}
