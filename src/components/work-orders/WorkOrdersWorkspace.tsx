'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import DetailDialog from '../ui/DetailDialog'
import ListControls from '../ui/ListControls'

type Job = {
  id: string
  name: string
  status: string
  startDate: string
  endDate?: string | null
  defaultDurationMin: number
  requiredWorkers: number
  site: { name: string; city: string; client: { displayName: string } }
  servicePlanVersion?: { versionNumber: number } | null
  _count: { visits: number }
}

async function getJobs(): Promise<Job[]> {
  const response = await fetch('/api/jobs', { credentials: 'include', cache: 'no-store' })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not load work orders.')
  return body.data as Job[]
}

function formatDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : 'Ongoing'
}

export default function WorkOrdersWorkspace() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'paused'>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setJobs(await getJobs()) } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load work orders.') } finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return jobs.filter((job) => (status === 'all' || job.status === status) && (!needle || `${job.name} ${job.site.name} ${job.site.client.displayName}`.toLowerCase().includes(needle)) && (!from || job.startDate.slice(0, 10) >= from) && (!to || job.startDate.slice(0, 10) <= to))
  }, [from, jobs, query, status, to])
  const selected = useMemo(() => jobs.find((job) => job.id === selectedId) ?? null, [jobs, selectedId])
  const active = jobs.filter((job) => job.status === 'active').length
  const visits = jobs.reduce((total, job) => total + job._count.visits, 0)

  return <main className="page-shell manager-page">
    <header className="manager-header">
      <div><span className="eyebrow">Operational delivery</span><h1>Work orders</h1><p className="muted">The live bridge between a contracted service plan and the visits your team executes.</p></div>
      <a className="btn-primary" href="/schedule">+ Schedule work</a>
    </header>
    <section className="manager-kpis" aria-label="Work order overview">
      <article><span>Active work orders</span><strong>{active}</strong><small>Currently generating work</small></article>
      <article><span>Scheduled visits</span><strong>{visits}</strong><small>Across every work order</small></article>
      <article><span>Unassigned work</span><strong>{jobs.filter((job) => job.requiredWorkers > 0 && job._count.visits === 0).length}</strong><small>Needs a scheduling decision</small></article>
      <article className="manager-kpi-action"><strong>Dispatch from the schedule</strong><small>Use the calendar to assign people, time and recurrence.</small></article>
    </section>
    {message ? <div className="toast error" role="alert">{message}<button className="notice-close" onClick={() => setMessage(null)}>×</button></div> : null}
    <section className="manager-workspace manager-workspace-single">
      <div className="manager-list card">
        <div className="manager-list-toolbar work-orders-toolbar"><div><h2>Work order register</h2><span className="muted">{loading ? 'Loading…' : `${visible.length} result${visible.length === 1 ? '' : 's'}`}</span></div><ListControls query={query} onQueryChange={setQuery} from={from} to={to} onFromChange={setFrom} onToChange={setTo} placeholder="Search client, site or work order…" /></div>
        <div className="filter-chips" aria-label="Filter work orders"><button className={status === 'all' ? 'selected' : ''} onClick={() => setStatus('all')}>All</button><button className={status === 'active' ? 'selected' : ''} onClick={() => setStatus('active')}>Active</button><button className={status === 'paused' ? 'selected' : ''} onClick={() => setStatus('paused')}>Paused</button></div>
        <div className="manager-table work-orders-table scroll-list" role="table" aria-label="Work orders">
          <div className="manager-table-head" role="row"><span>Work order</span><span>Visits</span><span>Service window</span><span>Status</span></div>
          {visible.map((job) => <button className={selected?.id === job.id ? 'manager-row selected' : 'manager-row'} key={job.id} onClick={() => setSelectedId(job.id)}><span><b>{job.name}</b><small>{job.site.client.displayName} · {job.site.name}</small></span><span>{job._count.visits}</span><span>{formatDate(job.startDate)}</span><span className={`status-badge ${job.status === 'active' ? 'Completed' : 'Pending'}`}>{job.status}</span></button>)}
          {!loading && !visible.length ? <div className="empty-state">No work orders match this view.</div> : null}
        </div>
      </div>
    </section>
    <DetailDialog open={Boolean(selected)} title={selected?.name ?? 'Work order'} eyebrow="Work order" onClose={() => setSelectedId(null)}>
      {selected ? <div className="manager-detail"><span className={`status-badge ${selected.status === 'active' ? 'Completed' : 'Pending'}`}>{selected.status}</span><dl><div><dt>Client</dt><dd>{selected.site.client.displayName}</dd></div><div><dt>Site</dt><dd>{selected.site.name}, {selected.site.city}</dd></div><div><dt>Visits</dt><dd>{selected._count.visits}</dd></div><div><dt>Plan version</dt><dd>v{selected.servicePlanVersion?.versionNumber ?? '—'}</dd></div><div><dt>Default visit</dt><dd>{selected.defaultDurationMin} min · {selected.requiredWorkers} worker{selected.requiredWorkers === 1 ? '' : 's'}</dd></div><div><dt>Service through</dt><dd>{formatDate(selected.endDate)}</dd></div></dl><a className="btn-primary full-width" href="/schedule">Open dispatch calendar →</a><a className="btn-secondary full-width" href="/operations">Review service setup →</a></div> : null}
    </DetailDialog>
  </main>
}
