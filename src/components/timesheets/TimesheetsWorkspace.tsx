'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import ListControls from '../ui/ListControls'
import { formatOperationalDateTime } from '../../lib/operational-time'

type Entry = { id: string; kind: string; status: string; startedAt: string; endedAt?: string | null; user: { name?: string | null; email: string }; visit?: { site: { name: string; client: { displayName: string } } } | null; locationEvents: Array<{ classification?: string | null; distanceM?: number | null }>; disputes: Array<{ id: string; status: string }> }

function duration(entry: Entry) { return entry.endedAt ? Math.max(0, new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) : 0 }
function humanDuration(value: number) { const minutes = Math.round(value / 60_000); return `${Math.floor(minutes / 60)}h ${minutes % 60}m` }
function isoDate(date: Date) { const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 10) }

export default function TimesheetsWorkspace({ canManage }: { canManage: boolean }) {
  const now = useMemo(() => new Date(), [])
  const [entries, setEntries] = useState<Entry[]>([])
  const [tab, setTab] = useState<'review' | 'payroll'>('review')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'needs_review' | 'approved'>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState(isoDate(new Date(now.getTime() - 29 * 86_400_000)))
  const [to, setTo] = useState(isoDate(now))

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
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not load timesheets.') }
    finally { setLoading(false) }
  }, [from, to])
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 120); return () => window.clearTimeout(timer) }, [refresh])

  const reviewEntry = useCallback(async (entry: Entry, decision: 'approved' | 'rejected') => {
    setBusyId(entry.id)
    try {
      const response = await fetch(`/api/time-entries/${entry.id}/review`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: decision === 'approved' ? 'Approved from the timesheet workspace.' : 'Rejected from the timesheet workspace.' }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not review this entry.')
      setNotice(decision === 'approved' ? 'Time entry approved.' : 'Time entry rejected.')
      await refresh()
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not review this entry.') }
    finally { setBusyId(null) }
  }, [refresh])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => (filter === 'all' || entry.status === filter) && (!needle || `${entry.user.name ?? ''} ${entry.user.email} ${entry.kind} ${entry.visit?.site.name ?? ''} ${entry.visit?.site.client.displayName ?? ''}`.toLowerCase().includes(needle)))
  }, [entries, filter, query])
  const reviewEntries = entries.filter((entry) => entry.status === 'needs_review' || entry.disputes.some((dispute) => dispute.status === 'open'))
  const approvedEntries = entries.filter((entry) => entry.status === 'approved')
  const approvedTotal = approvedEntries.reduce((sum, entry) => sum + duration(entry), 0)
  const pendingTotal = reviewEntries.reduce((sum, entry) => sum + duration(entry), 0)

  return <main className="page-shell manager-page">
    <header className="manager-header"><div><span className="eyebrow">Workforce control</span><h1>Timesheets</h1><p className="muted">Review time with its job context, distance signal and employee challenge in one place.</p></div>{canManage ? <a href="/field-control" className="btn-secondary">Open field control →</a> : null}</header>
    <nav className="manager-tabs" aria-label="Timesheet sections"><button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>{canManage ? 'Review time' : 'My time'} <span>{reviewEntries.length}</span></button>{canManage ? <button className={tab === 'payroll' ? 'active' : ''} onClick={() => setTab('payroll')}>Payroll preview</button> : null}</nav>
    {notice ? <div className="toast success" role="status">{notice}<button className="notice-close" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button></div> : null}

    <section className="card timesheet-period-control"><div><span className="eyebrow">Review period</span><strong>{from || 'Start'} → {to || 'Today'}</strong><small>Review and payroll preview always use this same period.</small></div><ListControls query={tab === 'review' ? query : ''} onQueryChange={tab === 'review' ? setQuery : () => undefined} from={from} to={to} onFromChange={setFrom} onToChange={setTo} placeholder="Search employee, site or work…" hasActiveFilters={Boolean((tab === 'review' && query.trim()) || from || to || filter !== 'all')} onClear={() => { setQuery(''); setFrom(''); setTo(''); setFilter('all') }} /></section>

    {tab === 'review' ? <section className="card timesheet-card"><div className="timesheet-toolbar"><div><h2>{canManage ? 'Logged hours' : 'My logged hours'}</h2><p className="muted">{canManage ? 'Approve only when the evidence and exception context make sense.' : 'Review your clock in/out records, visits and any location flags.'}</p></div><div className="filter-pills">{(['all','needs_review','approved'] as const).map((value) => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'needs_review' ? 'Needs review' : 'Approved'}</button>)}</div></div><div className="timesheet-table scroll-list"><div className="timesheet-head"><span>Employee</span><span>Work</span><span>Start</span><span>Duration</span><span>Review</span></div>{filtered.map((entry) => <div className="timesheet-row" key={entry.id}><span><b>{entry.user.name || entry.user.email}</b><small>{entry.kind.replace('_', ' ')}</small></span><span>{entry.visit ? `${entry.visit.site.client.displayName} · ${entry.visit.site.name}` : 'General / non-visit time'}</span><span>{formatOperationalDateTime(entry.startedAt)}</span><span>{entry.endedAt ? humanDuration(duration(entry)) : 'Running'}</span><span className="timesheet-review-cell">{entry.disputes.some((dispute) => dispute.status === 'open') ? <b className="review-flag">Challenge open</b> : entry.locationEvents.some((event) => ['outside','suspicious','unavailable'].includes(event.classification ?? '')) ? <b className="review-flag">Location review</b> : <span className={`status-badge ${entry.status === 'approved' ? 'Completed' : 'Pending'}`}>{entry.status.replace('_', ' ')}</span>}{canManage && entry.status === 'needs_review' ? <span className="timesheet-review-actions"><button disabled={busyId === entry.id} className="text-button" onClick={() => void reviewEntry(entry, 'approved')}>Approve</button><button disabled={busyId === entry.id} className="text-button danger" onClick={() => void reviewEntry(entry, 'rejected')}>Reject</button></span> : null}</span></div>)}{!loading && !filtered.length ? <div className="empty-state">No time entries in this filter.</div> : null}</div></section> : null}

    {tab === 'payroll' && canManage ? <section className="payroll-preview payroll-preview-v10"><article className="card"><span className="eyebrow">Approved time</span><strong>{humanDuration(approvedTotal)}</strong><p className="muted">Only approved entries in {from || 'the start'} → {to || 'today'} are included.</p></article><article className={`card ${reviewEntries.length ? 'attention-card' : ''}`}><span className="eyebrow">Awaiting review</span><strong>{reviewEntries.length}</strong><p className="muted">{humanDuration(pendingTotal)} is not payroll-ready yet.</p></article><article className="card"><span className="eyebrow">Period readiness</span><h2>{reviewEntries.length ? 'Review exceptions' : 'Review complete'}</h2><p className="muted">Original clock records remain immutable; approval decisions are auditable.</p>{reviewEntries.length ? <a className="btn-primary" href="/field-control">Review exceptions</a> : <span className="status-badge Completed">Ready for payroll release flow</span>}</article></section> : null}
  </main>
}
