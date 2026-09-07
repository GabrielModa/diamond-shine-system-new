'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ApiResponse, FeedbackEntry } from '../../types'
import StandardSelect from '../ui/StandardSelect'
import { FeedbackDetailSheet } from '../dashboard/FeedbackDetailSheet'
import styles from './ServiceFeedbackWorkspace.module.css'

type FeedbackMetrics = {
  overall: number
  cleanliness: number
  clientRelations: number
  attention: number
}

type FeedbackPage = {
  total: number
  items: FeedbackEntry[]
  employees: string[]
  metrics: FeedbackMetrics
  pagination: {
    page: number
    pageSize: number
    totalPages: number
    hasMore: boolean
  }
}

const PAGE_SIZE = 50

async function fetchFeedback(options: {
  page: number
  query: string
  employee: string
  category: string
}): Promise<FeedbackPage> {
  const params = new URLSearchParams({
    page: String(options.page),
    pageSize: String(PAGE_SIZE),
  })
  if (options.query.trim()) params.set('query', options.query.trim())
  if (options.employee) params.set('employee', options.employee)
  if (options.category) params.set('category', options.category)

  const response = await fetch('/api/feedback?' + params.toString(), {
    credentials: 'include',
    cache: 'no-store',
  })
  const payload = await response.json() as ApiResponse<FeedbackPage>
  if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error || 'Could not load service feedback.')
  return payload.data
}

export default function ServiceFeedbackWorkspace() {
  const [items, setItems] = useState<FeedbackEntry[]>([])
  const [employees, setEmployees] = useState<string[]>([])
  const [metrics, setMetrics] = useState<FeedbackMetrics>({
    overall: 0,
    cleanliness: 0,
    clientRelations: 0,
    attention: 0,
  })
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [employee, setEmployee] = useState('')
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState<FeedbackEntry | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchFeedback({ page, query, employee, category })
      setItems(data.items)
      setEmployees(data.employees)
      setMetrics(data.metrics)
      setTotal(data.total)
      setTotalPages(data.pagination.totalPages)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load service feedback.')
    } finally {
      setLoading(false)
    }
  }, [category, employee, page, query])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh() }, 250)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const evaluationLabel = total === 1 ? 'evaluation' : 'evaluations'
  const scopeLabel = employee || category || query.trim()
    ? `${total} matching ${evaluationLabel}`
    : `${total} ${evaluationLabel}`

  return <main className={`page-shell ${styles.workspace}`}>
    <header className={styles.hero}>
      <div>
        <span className="eyebrow">Client experience</span>
        <h1>Service feedback</h1>
        <p className="muted">See how delivered cleaning is being rated, spot repeated concerns and open the exact evaluation behind the signal.</p>
      </div>
      <button type="button" className="btn-secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button>
    </header>

    {error ? <div className="toast error" role="alert">{error}</div> : null}

    <section className={styles.summary} aria-label="Feedback summary">
      <article><span>Average rating</span><strong>{loading ? '—' : metrics.overall ? metrics.overall.toFixed(1) : '—'}</strong><small>Current filtered view</small></article>
      <article><span>Cleanliness</span><strong>{loading ? '—' : metrics.cleanliness ? metrics.cleanliness.toFixed(1) : '—'}</strong><small>Average score</small></article>
      <article><span>Client relations</span><strong>{loading ? '—' : metrics.clientRelations ? metrics.clientRelations.toFixed(1) : '—'}</strong><small>Average score</small></article>
      <article className={metrics.attention ? styles.attention : ''}><span>Needs attention</span><strong>{loading ? '—' : metrics.attention}</strong><small>Ratings below 4.0</small></article>
    </section>

    <section className={`card ${styles.panel}`}>
      <div className="section-heading">
        <div><h2>Feedback history</h2><p className="muted">{scopeLabel}</p></div>
      </div>
      <div className={styles.filters}>
        <label>Search<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Employee, location or comment…" /></label>
        <div className={styles.selectField}><span>Employee</span><StandardSelect searchable={employees.length > 8} value={employee} onChange={(value) => { setEmployee(value); setPage(1) }} ariaLabel="Employee" options={[{ value: '', label: 'All employees' }, ...employees.map((name) => ({ value: name, label: name }))]} /></div>
        <div className={styles.selectField}><span>Rating</span><StandardSelect value={category} onChange={(value) => { setCategory(value); setPage(1) }} ariaLabel="Rating category" options={[{ value: '', label: 'All ratings' }, { value: 'Excellent', label: 'Excellent' }, { value: 'Very Good', label: 'Very good' }, { value: 'Good', label: 'Good' }, { value: 'Fair', label: 'Fair' }, { value: 'Poor', label: 'Poor' }]} /></div>
        {(query || employee || category) ? <button type="button" className="btn-secondary" onClick={() => { setQuery(''); setEmployee(''); setCategory(''); setPage(1) }}>Clear filters</button> : null}
      </div>

      {loading ? <div className="empty-state">Loading service feedback…</div> : <div className={styles.history}>
        {items.map((entry) => <button type="button" className={styles.row} key={entry.id} onClick={() => setSelected(entry)}>
          <div><strong>{entry.employeeName}</strong><small>{entry.clientLocation} · {new Date(entry.createdAt).toLocaleDateString('en-IE')}</small></div>
          <span className={`${styles.score} ${entry.overall < 4 ? styles.attention : ''}`}>{entry.overall.toFixed(1)}</span>
          <div><strong>{entry.category}</strong><small>{entry.comments || 'No comment'}</small></div>
          <span aria-hidden="true">→</span>
        </button>)}
        {items.length === 0 ? <div className="empty-state">No feedback matches the current filters.</div> : null}
      </div>}

      {totalPages > 1 ? <div className={styles.pagination}>
        <button type="button" className="btn-secondary" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
        <span>Page {page} of {totalPages}</span>
        <button type="button" className="btn-secondary" disabled={loading || page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</button>
      </div> : null}
    </section>

    <FeedbackDetailSheet open={Boolean(selected)} active={Boolean(selected)} entry={selected} onClose={() => setSelected(null)} />
  </main>
}
