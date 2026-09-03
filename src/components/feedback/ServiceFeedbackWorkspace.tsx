'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApiResponse, FeedbackEntry } from '../../types'
import StandardSelect from '../ui/StandardSelect'
import { FeedbackDetailSheet } from '../dashboard/FeedbackDetailSheet'

async function fetchFeedback(): Promise<FeedbackEntry[]> {
  const response = await fetch('/api/feedback', { credentials: 'include', cache: 'no-store' })
  const payload = await response.json() as ApiResponse<{ items: FeedbackEntry[] }>
  if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || 'Could not load service feedback.')
  return payload.data.items
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

export default function ServiceFeedbackWorkspace() {
  const [items, setItems] = useState<FeedbackEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [employee, setEmployee] = useState('')
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState<FeedbackEntry | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setItems(await fetchFeedback()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load service feedback.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const employees = useMemo(() => [...new Set(items.map((item) => item.employeeName))].sort((a, b) => a.localeCompare(b)), [items])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter((item) => (
      (!employee || item.employeeName === employee)
      && (!category || item.category === category)
      && (!needle || `${item.employeeName} ${item.clientLocation} ${item.comments ?? ''} ${item.category}`.toLowerCase().includes(needle))
    ))
  }, [category, employee, items, query])

  const metrics = useMemo(() => {
    const overall = average(visible.map((item) => item.overall))
    const cleanliness = average(visible.map((item) => item.cleanliness))
    const clientRelations = average(visible.map((item) => item.clientRelations))
    const attention = visible.filter((item) => item.overall < 4).length
    return { overall, cleanliness, clientRelations, attention }
  }, [visible])

  const scopeLabel = employee || category || query.trim()
    ? `${visible.length} of ${items.length} evaluations`
    : `${visible.length} evaluations`

  return <main className="page-shell feedback-workspace">
    <header className="page-header page-header-action">
      <div>
        <span className="eyebrow">Client experience</span>
        <h1>Service feedback</h1>
        <p className="muted">See how delivered cleaning is being rated, spot repeated concerns and open the exact evaluation behind the signal.</p>
      </div>
      <button type="button" className="btn-secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
    </header>

    {error ? <div className="toast error" role="alert">{error}</div> : null}

    <section className="materials-summary" aria-label="Feedback summary">
      <article><span>Average rating</span><strong>{loading ? '—' : metrics.overall ? metrics.overall.toFixed(1) : '—'}</strong><small>Current filtered view</small></article>
      <article><span>Cleanliness</span><strong>{loading ? '—' : metrics.cleanliness ? metrics.cleanliness.toFixed(1) : '—'}</strong><small>Average score</small></article>
      <article><span>Client relations</span><strong>{loading ? '—' : metrics.clientRelations ? metrics.clientRelations.toFixed(1) : '—'}</strong><small>Average score</small></article>
      <article className={metrics.attention ? 'attention' : ''}><span>Needs attention</span><strong>{loading ? '—' : metrics.attention}</strong><small>Ratings below 4.0</small></article>
    </section>

    <section className="card">
      <div className="section-heading">
        <div><h2>Feedback history</h2><p className="muted">{scopeLabel}</p></div>
      </div>
      <div className="feedback-filter-grid">
        <label>Search<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Employee, location or comment…" /></label>
        <div className="quality-select-field"><span>Employee</span><StandardSelect searchable={employees.length > 8} value={employee} onChange={setEmployee} ariaLabel="Employee" options={[{ value: '', label: 'All employees' }, ...employees.map((name) => ({ value: name, label: name }))]} /></div>
        <div className="quality-select-field"><span>Rating</span><StandardSelect value={category} onChange={setCategory} ariaLabel="Rating category" options={[{ value: '', label: 'All ratings' }, { value: 'Excellent', label: 'Excellent' }, { value: 'Very Good', label: 'Very good' }, { value: 'Good', label: 'Good' }, { value: 'Fair', label: 'Fair' }, { value: 'Poor', label: 'Poor' }]} /></div>
        {(query || employee || category) ? <button type="button" className="btn-secondary" onClick={() => { setQuery(''); setEmployee(''); setCategory('') }}>Clear filters</button> : null}
      </div>

      {loading ? <div className="empty-state">Loading service feedback…</div> : <div className="feedback-history-list">
        {visible.map((entry) => <button type="button" className="feedback-history-row" key={entry.id} onClick={() => setSelected(entry)}>
          <div><strong>{entry.employeeName}</strong><small>{entry.clientLocation} · {new Date(entry.createdAt).toLocaleDateString('en-IE')}</small></div>
          <span className={`feedback-score ${entry.overall < 4 ? 'attention' : ''}`}>{entry.overall.toFixed(1)}</span>
          <div><strong>{entry.category}</strong><small>{entry.comments || 'No comment'}</small></div>
          <span aria-hidden="true">→</span>
        </button>)}
        {!visible.length ? <div className="empty-state">No feedback matches the current filters.</div> : null}
      </div>}
    </section>

    <FeedbackDetailSheet open={Boolean(selected)} active={Boolean(selected)} entry={selected} onClose={() => setSelected(null)} />
  </main>
}
