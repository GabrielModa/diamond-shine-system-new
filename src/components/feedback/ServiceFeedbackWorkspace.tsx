'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ApiResponse, FeedbackEntry } from '../../types'
import StandardSelect from '../ui/StandardSelect'
import { FeedbackDetailSheet } from '../dashboard/FeedbackDetailSheet'
import styles from './ServiceFeedbackWorkspace.module.css'
import EmployeeFeedbackOverview, { type EmployeeFeedbackSummary, type FeedbackTrend } from './EmployeeFeedbackOverview'
import OpsIcon from '../ui/OpsIcon'

type FeedbackMetrics = {
  overall: number
  cleanliness: number
  punctuality: number
  equipment: number
  clientRelations: number
  attention: number
}

type FeedbackPage = {
  total: number
  items: FeedbackEntry[]
  employees: string[]
  metrics: FeedbackMetrics
  employeeSummaries: EmployeeFeedbackSummary[]
  trend: FeedbackTrend
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

const EMPTY_METRICS: FeedbackMetrics = {
  overall: 0,
  cleanliness: 0,
  punctuality: 0,
  equipment: 0,
  clientRelations: 0,
  attention: 0,
}

const EMPTY_TREND: FeedbackTrend = {
  currentCount: 0,
  previousCount: 0,
  currentAverage: null,
  previousAverage: null,
  delta: null,
}

export default function ServiceFeedbackWorkspace() {
  const [summary, setSummary] = useState<FeedbackPage | null>(null)
  const [items, setItems] = useState<FeedbackEntry[]>([])
  const [employees, setEmployees] = useState<string[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [employee, setEmployee] = useState('')
  const [category, setCategory] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selected, setSelected] = useState<FeedbackEntry | null>(null)

  const refreshSummary = useCallback(async () => {
    setSummaryLoading(true)
    setError('')
    try {
      const data = await fetchFeedback({ page: 1, query: '', employee: '', category: '' })
      setSummary(data)
      setEmployees(data.employees)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load service feedback.')
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  const refreshHistory = useCallback(async () => {
    if (!historyOpen) return
    setHistoryLoading(true)
    setError('')
    try {
      const data = await fetchFeedback({ page, query, employee, category })
      setItems(data.items)
      setEmployees(data.employees)
      setHistoryTotal(data.total)
      setTotalPages(data.pagination.totalPages)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load feedback history.')
    } finally {
      setHistoryLoading(false)
    }
  }, [category, employee, historyOpen, page, query])

  useEffect(() => { void refreshSummary() }, [refreshSummary])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refreshHistory() }, 180)
    return () => window.clearTimeout(timer)
  }, [refreshHistory])

  useEffect(() => {
    if (!historyOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !selected) setHistoryOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [historyOpen, selected])

  const metrics = summary?.metrics ?? EMPTY_METRICS
  const employeeSummaries = summary?.employeeSummaries ?? []
  const trend = summary?.trend ?? EMPTY_TREND
  const attentionEmployees = employeeSummaries.filter((item) => item.overall < 4).length
  const historyLabel = historyTotal === 1 ? '1 evaluation' : `${historyTotal} evaluations`

  function openHistoryFor(name = '') {
    setEmployee(name)
    setQuery('')
    setCategory('')
    setPage(1)
    setHistoryOpen(true)
  }

  function clearHistoryFilters() {
    setQuery('')
    setEmployee('')
    setCategory('')
    setPage(1)
  }

  return <main className={`page-shell ${styles.workspace}`}>
    <header className={styles.hero}>
      <div>
        <span className="eyebrow">Client experience</span>
        <h1>Service feedback</h1>
        <p className="muted">See how delivered cleaning is being rated, spot repeated concerns and open the exact evaluation behind the signal.</p>
      </div>
      <button type="button" className="btn-secondary" onClick={() => void refreshSummary()} disabled={summaryLoading}><OpsIcon name="refresh" size={16} /> Refresh</button>
    </header>

    {error ? <div className="toast error" role="alert">{error}</div> : null}

    {!summaryLoading ? <EmployeeFeedbackOverview
      employees={employeeSummaries}
      totalEvaluations={employeeSummaries.reduce((sum, item) => sum + item.evaluations, 0)}
      attention={attentionEmployees}
      average={metrics.overall}
      trend={trend}
      onEmployee={(name) => openHistoryFor(name)}
      onHistory={() => openHistoryFor()}
    /> : <section className="card empty-state">Loading employee feedback performance…</section>}

    {historyOpen ? <div className={styles.historyBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !selected) setHistoryOpen(false) }}>
      <section className={styles.historyDrawer} role="dialog" aria-modal="true" aria-labelledby="feedback-history-title">
        <header className={styles.historyDrawerHead}>
          <div><span className="eyebrow">Evaluation evidence</span><h2 id="feedback-history-title">{employee ? `${employee} · feedback history` : 'Feedback history'}</h2><p>{historyLoading ? 'Refreshing…' : historyLabel}</p></div>
          <button type="button" className={styles.drawerClose} onClick={() => setHistoryOpen(false)} aria-label="Close feedback history">×</button>
        </header>

        <div className={styles.drawerFilters}>
          <label>Search<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Employee, location or comment…" /></label>
          <div className={styles.selectField}><span>Employee</span><StandardSelect searchable={employees.length > 8} value={employee} onChange={(value) => { setEmployee(value); setPage(1) }} ariaLabel="Employee" options={[{ value: '', label: 'All employees' }, ...employees.map((name) => ({ value: name, label: name }))]} /></div>
          <div className={styles.selectField}><span>Rating</span><StandardSelect value={category} onChange={(value) => { setCategory(value); setPage(1) }} ariaLabel="Rating category" options={[{ value: '', label: 'All ratings' }, { value: 'Excellent', label: 'Excellent' }, { value: 'Very Good', label: 'Very good' }, { value: 'Good', label: 'Good' }, { value: 'Fair', label: 'Fair' }, { value: 'Poor', label: 'Poor' }]} /></div>
          {(query || employee || category) ? <button type="button" className="btn-secondary" onClick={clearHistoryFilters}>Clear filters</button> : null}
        </div>

        <div className={styles.drawerBody}>
          {historyLoading ? <div className="empty-state">Loading feedback history…</div> : <div className={styles.history}>
            {items.map((entry) => <button type="button" className={styles.row} key={entry.id} onClick={() => setSelected(entry)}>
              <div><strong>{entry.employeeName}</strong><small>{entry.clientLocation} · {new Date(entry.createdAt).toLocaleDateString('en-IE')}</small></div>
              <span className={`${styles.score} ${entry.overall < 4 ? styles.attention : ''}`}>{entry.overall.toFixed(1)}</span>
              <div><strong>{entry.category}</strong><small>{entry.comments || 'No comment'}</small></div>
              <span aria-hidden="true">→</span>
            </button>)}
            {!items.length ? <div className="empty-state">No feedback matches the current filters.</div> : null}
          </div>}
        </div>

        {totalPages > 1 ? <footer className={styles.pagination}>
          <button type="button" className="btn-secondary" disabled={historyLoading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
          <span>Page {page} of {totalPages}</span>
          <button type="button" className="btn-secondary" disabled={historyLoading || page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next</button>
        </footer> : null}
      </section>
    </div> : null}

    <FeedbackDetailSheet open={Boolean(selected)} active={Boolean(selected)} entry={selected} onClose={() => setSelected(null)} />
  </main>
}
