'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ApiResponse } from '../../../types'
import ListControls from '../../../components/ui/ListControls'

type AuditLog = { id: string; actorEmail: string; action: string; targetType: string; targetId: string | null; metadata: string | null; createdAt: string }

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/audit?limit=100', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as ApiResponse<AuditLog[]>
        if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error ?? 'Failed to load audit trail')
        setLogs(payload.data)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Failed to load audit trail'))
  }, [])

  const targets = useMemo(() => Array.from(new Set(logs.map((log) => log.targetType))).sort(), [logs])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return logs.filter((log) => (target === 'all' || log.targetType === target) && (!needle || `${log.action} ${log.actorEmail} ${log.targetId ?? ''}`.toLowerCase().includes(needle)) && (!from || log.createdAt.slice(0, 10) >= from) && (!to || log.createdAt.slice(0, 10) <= to))
  }, [from, logs, query, target, to])

  return (
    <main className="page-shell">
      <header className="page-header"><h1>Audit Trail</h1><p className="muted">Review who changed what and when across the operation.</p></header>
      <section className="card">
        <div className="admin-toolbar"><ListControls query={query} onQueryChange={setQuery} from={from} to={to} onFromChange={setFrom} onToChange={setTo} placeholder="Search action, actor or target…" /><select aria-label="Filter target type" value={target} onChange={(event) => setTarget(event.target.value)}><option value="all">All target types</option>{targets.map((item) => <option key={item}>{item}</option>)}</select></div>
        {error ? <div className="toast error" role="alert">{error}</div> : null}
        {!error && filtered.length === 0 ? <div className="empty-state">No audit events match these filters.</div> : null}
        <div className="audit-table scroll-list" role="table" aria-label="Audit events">
          {filtered.map((log) => (
            <div key={log.id} className="audit-row" role="row">
              <div><strong>{log.action.replaceAll('_', ' ')}</strong><div className="muted">{log.actorEmail}</div></div>
              <span className="badge normal">{log.targetType}</span>
              <div className="muted">{log.targetId ?? '—'}</div>
              <time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString('en-IE')}</time>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
