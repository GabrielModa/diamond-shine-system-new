'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ApiResponse } from '../../../types'
import ListControls from '../../../components/ui/ListControls'

type AuditLog = { id: string; actorEmail: string; action: string; targetType: string; targetId: string | null; metadata: string | null; createdAt: string }
type AuditData = { items: AuditLog[]; total: number; page: number; limit: number; totalPages: number; targetTypes: string[] }

export default function AuditPage() {
  const [data, setData] = useState<AuditData>({ items: [], total: 0, page: 1, limit: 30, totalPages: 1, targetTypes: [] })
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ page: String(page), limit: '30' })
      if (query.trim()) params.set('search', query.trim())
      if (target !== 'all') params.set('targetType', target)
      if (from) params.set('from', `${from}T00:00:00.000Z`)
      if (to) params.set('to', `${to}T23:59:59.999Z`)
      const response = await fetch(`/api/audit?${params}`, { credentials: 'include', cache: 'no-store' })
      const payload = await response.json() as ApiResponse<AuditData>
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error ?? 'Failed to load audit trail')
      setData(payload.data)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Failed to load audit trail') }
    finally { setLoading(false) }
  }, [from, page, query, target, to])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => { setPage(1) }, [query, target, from, to])

  return <main className="page-shell audit-page">
    <header className="page-header"><div><span className="eyebrow">Governance & traceability</span><h1>Audit trail</h1><p className="muted">Search who changed what, when and why without loading the entire history into the browser.</p></div></header>
    <section className="card">
      <div className="admin-toolbar audit-toolbar"><ListControls query={query} onQueryChange={setQuery} from={from} to={to} onFromChange={setFrom} onToChange={setTo} placeholder="Search action, actor or target…" hasActiveFilters={Boolean(query.trim() || from || to || target !== 'all')} onClear={() => { setQuery(''); setFrom(''); setTo(''); setTarget('all') }} options={[{ label: 'Target type', value: target, defaultValue: 'all', choices: [{ value: 'all', label: 'All target types' }, ...data.targetTypes.map((item) => ({ value: item, label: item }))], onChange: setTarget }]} /></div>
      {error ? <div className="toast error" role="alert">{error}</div> : null}
      <div className="audit-result-meta"><span>{loading ? 'Loading…' : `${data.total} event${data.total === 1 ? '' : 's'}`}</span><span>Page {data.page} of {data.totalPages}</span></div>
      {!error && !loading && !data.items.length ? <div className="empty-state">No audit events match these filters.</div> : null}
      <div className="audit-table scroll-list" role="table" aria-label="Audit events">
        {data.items.map((log) => <article key={log.id} className="audit-row audit-row-v10" role="row">
          <button type="button" className="audit-row-main" aria-expanded={expanded === log.id} onClick={() => setExpanded((current) => current === log.id ? null : log.id)}>
            <div><strong>{log.action.replaceAll('_', ' ')}</strong><div className="muted">{log.actorEmail}</div></div>
            <span className="badge normal">{log.targetType}</span>
            <div className="muted">{log.targetId ?? '—'}</div>
            <time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString('en-IE')}</time>
          </button>
          {expanded === log.id ? <div className="audit-metadata"><strong>Change metadata</strong><pre>{formatMetadata(log.metadata)}</pre></div> : null}
        </article>)}
      </div>
      <footer className="audit-pagination"><button className="btn-secondary" disabled={loading || data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← Newer</button><span>{data.page} / {data.totalPages}</span><button className="btn-secondary" disabled={loading || data.page >= data.totalPages} onClick={() => setPage((value) => value + 1)}>Older →</button></footer>
    </section>
  </main>
}

function formatMetadata(value: string | null) {
  if (!value) return 'No metadata recorded.'
  try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value }
}
