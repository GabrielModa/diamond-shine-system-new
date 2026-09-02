'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { formatOperationalDateTime } from '../../lib/operational-time'
import OpsIcon from '../ui/OpsIcon'
import './TimesheetsWorkspace.css'

type Entry = {
  id: string
  kind: string
  status: string
  startedAt: string
  endedAt?: string | null
  durationSeconds?: number | null
  reviewReason?: string | null
  user: { id: string; name?: string | null; email: string }
  visit?: {
    id: string
    status: string
    site: { id: string; name: string; client: { id: string; displayName: string } }
  } | null
  locationEvents: Array<{ id: string; kind: string; classification?: string | null; distanceM?: number | null; accuracyM?: number | null }>
  disputes: Array<{ id: string; reason?: string; status: string; resolution?: string | null }>
}

type StatusFilter = 'all' | 'recorded' | 'needs_review' | 'approved' | 'rejected' | 'running' | 'challenge'
type ExportScope = 'filtered' | 'period'
type ExportLayout = 'summary' | 'detailed'

function entryDurationMs(entry: Entry) {
  if (!entry.endedAt) return 0
  return Math.max(0, new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime())
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
  return entry.locationEvents.some((event) => ['suspicious', 'outside', 'unavailable'].includes(event.classification ?? ''))
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

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', `${from}T00:00:00.000Z`)
      if (to) params.set('to', `${to}T23:59:59.999Z`)
      const response = await fetch(`/api/time-entries?${params}`, { credentials: 'include', cache: 'no-store' })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not load timesheets.')
      setEntries(body.data as Entry[])
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
    if (!focusedEntryId) return
    setTab('review')
    setEmployeeFilter('all')
    setStatusFilter('all')
    setKindFilter('all')
    setClientFilter('all')
    setQuery('')
  }, [focusedEntryId])

  const reviewEntry = useCallback(async (entry: Entry, decision: 'approved' | 'rejected') => {
    setBusyId(entry.id)
    try {
      const response = await fetch(`/api/time-entries/${entry.id}/review`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          note: decision === 'approved' ? 'Approved for payroll from Timesheets.' : 'Rejected from Timesheets payroll review.',
        }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not review this entry.')
      setNotice({ kind: 'success', text: decision === 'approved' ? 'Time approved and payroll-ready.' : 'Time entry rejected.' })
      await refresh()
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not review this entry.' })
    } finally {
      setBusyId(null)
    }
  }, [refresh])

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
      approvedMs: approved.reduce((sum, entry) => sum + entryDurationMs(entry), 0),
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
        pendingMs: 0,
        challenges: 0,
        needsReview: 0,
        exceptions: 0,
        running: 0,
      }
      group.entries += 1
      const ms = entryDurationMs(entry)
      if (entry.endedAt) group.recordedMs += ms
      if (entry.status === 'approved') group.approvedMs += ms
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
        'Review status', 'Open challenge', 'Location signal', 'Maximum distance (m)',
      ]]
      for (const entry of source) {
        const maxDistance = entry.locationEvents.reduce<number | null>((max, event) => {
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
          hasOpenChallenge(entry) ? 'Yes' : 'No',
          hasLocationReview(entry) ? 'Review' : entry.locationEvents.length ? 'OK / watch' : 'No location evidence',
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
          pendingMs: 0,
          challengeCount: 0,
          reviewCount: 0,
          exceptionCount: 0,
          runningCount: 0,
        }
        current.entries += 1
        const ms = entryDurationMs(entry)
        if (entry.endedAt) current.recordedMs += ms
        if (entry.status === 'approved') current.approvedMs += ms
        if (entry.status === 'completed' || entry.status === 'needs_review') current.pendingMs += ms
        if (hasOpenChallenge(entry)) current.challengeCount += 1
        if (entry.status === 'needs_review') current.reviewCount += 1
        if (hasOperationalException(entry)) current.exceptionCount += 1
        if (entry.status === 'running') current.runningCount += 1
        groups.set(entry.user.id, current)
      }
      const rows: unknown[][] = [[
        'Employee', 'Email', 'Recorded hours', 'Approved / payroll-ready hours', 'Pending hours',
        'Operational exceptions', 'Challenges', 'Needs review', 'Running timers', 'Entries',
      ]]
      for (const group of [...groups.values()].sort((a, b) => (a.user.name || a.user.email).localeCompare(b.user.name || b.user.email))) {
        rows.push([
          group.user.name || group.user.email,
          group.user.email,
          decimalHours(group.recordedMs),
          decimalHours(group.approvedMs),
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
      <article className="ts-metric ready"><span className="ts-metric-icon"><OpsIcon name="payroll" /></span><span>Payroll ready</span><strong>{humanDuration(metrics.approvedMs)}</strong><small>Approved time only</small></article>
    </section>

    <section className="ts-filterbar" aria-label="Timesheet filters">
      <div className="ts-search"><OpsIcon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employee, site or work…" /></div>
      <label className="ts-field"><span>Employee</span><select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}><option value="all">All employees</option>{employeeOptions.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
      <label className="ts-field"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}><option value="all">All statuses</option><option value="recorded">Recorded</option><option value="needs_review">Needs review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="running">Running</option><option value="challenge">Challenge open</option></select></label>
      <label className="ts-field"><span>Work type</span><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="all">All work types</option>{kindOptions.map((kind) => <option value={kind} key={kind}>{kind.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="ts-field"><span>Client</span><select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option value="all">All clients</option>{clientOptions.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
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
            <span className="ts-work"><strong>{entry.visit ? `${entry.visit.site.client.displayName} · ${entry.visit.site.name}` : 'General / non-visit time'}</strong><small>{entry.reviewReason ? entry.reviewReason.split(' | ')[0] : entry.visit ? 'Visit work' : 'Non-visit work'}</small></span>
            <span className="ts-kind">{entry.kind.replaceAll('_', ' ')}</span>
            <span>{formatOperationalDateTime(entry.startedAt)}</span>
            <span>{entry.endedAt ? humanDuration(entryDurationMs(entry)) : 'Running'}</span>
            <span className="ts-actions">
              <span className={`ts-status ${statusClass(entry)}`}>{statusLabel(entry)}</span>
              {canManage && operationalException ? <a className="ts-text-action" href={`/field-control?entry=${encodeURIComponent(entry.id)}`}>Open field context</a> : null}
              {canManage && entry.status === 'completed' && !operationalException ? <><button disabled={busyId === entry.id} className="ts-text-action" onClick={() => void reviewEntry(entry, 'approved')}>Approve</button><button disabled={busyId === entry.id} className="ts-text-action danger" onClick={() => void reviewEntry(entry, 'rejected')}>Reject</button></> : null}
            </span>
          </div>
        })}
        {!loading && !filtered.length ? <div className="ts-empty">No time entries match this period and filter.</div> : null}
      </div>
    </section> : null}

    {tab === 'payroll' && canManage ? <section className="ts-payroll-grid">
      <div className="ts-payroll-summary">
        <article className="ts-payroll-card"><span>Employees in view</span><strong>{payrollRows.length}</strong><small>The table below follows the active filters.</small></article>
        <article className="ts-payroll-card"><span>Payroll-ready hours</span><strong>{humanDuration(metrics.approvedMs)}</strong><small>Only approved time is included.</small></article>
        <article className="ts-payroll-card"><span>Still blocked</span><strong>{metrics.blockedCount}</strong><small>Unique entries awaiting approval or operational resolution.</small></article>
      </div>
      <div className="ts-payroll-list">
        <div className="ts-payroll-head"><span>Employee</span><span>Recorded</span><span>Approved</span><span>Pending</span><span>Exceptions</span><span>Running</span></div>
        {payrollRows.map((row) => <div className="ts-payroll-row" key={row.user.id}><strong>{row.user.name || row.user.email}</strong><span>{humanDuration(row.recordedMs)}</span><span>{humanDuration(row.approvedMs)}</span><span>{humanDuration(row.pendingMs)}</span><span>{row.exceptions}</span><span>{row.running}</span></div>)}
        {!payrollRows.length ? <div className="ts-empty">No payroll rows match this filter.</div> : null}
      </div>
    </section> : null}

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
