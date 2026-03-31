'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FeedbackEntry } from '../../types'
import { consecutiveExcellent } from '../../lib/business-logic'

type PerformanceOverviewProps = {
  feedback: FeedbackEntry[]
  onSelectFeedback: (entry: FeedbackEntry) => void
}

type EmployeeSummary = {
  name: string
  evaluations: FeedbackEntry[]
}

export function PerformanceOverview({ feedback, onSelectFeedback }: PerformanceOverviewProps) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeSummary | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setMounted(true)
  }, [])

  const employees = useMemo(() => {
    const map = new Map<string, FeedbackEntry[]>()
    for (const entry of feedback) {
      if (!map.has(entry.employeeName)) map.set(entry.employeeName, [])
      map.get(entry.employeeName)?.push(entry)
    }
    return Array.from(map.entries()).map(([name, evaluations]) => ({
      name,
      evaluations: evaluations.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    }))
  }, [feedback])

  const aggregate = useMemo(() => {
    const totalEmployees = employees.length
    const totalEvaluations = feedback.length
    const averageRating = totalEvaluations
      ? feedback.reduce((sum, item) => sum + item.overall, 0) / totalEvaluations
      : 0
    const excellentCount = feedback.filter((item) => item.overall >= 4.6).length
    return { totalEmployees, totalEvaluations, averageRating, excellentCount }
  }, [employees.length, feedback])

  const matches = useMemo(() => {
    if (debounced.length < 2) return [] as EmployeeSummary[]
    const needle = debounced.toLowerCase()
    return employees.filter((employee) => employee.name.toLowerCase().includes(needle))
  }, [debounced, employees])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && profileOpen) {
        setProfileOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [profileOpen])

  function renderProfile(employee: EmployeeSummary) {
    const evaluations = employee.evaluations
    const latest = evaluations[0]
    const average = evaluations.reduce((sum, item) => sum + item.overall, 0) / evaluations.length
    const streak = consecutiveExcellent(evaluations)
    const latestLocation = latest?.clientLocation ?? '—'

    return (
      <div className="employee-profile">
        <div className="profile-header">
          <h3>👤 {employee.name}</h3>
        </div>
        <div className="profile-grid">
          <div>
            <div className="muted">Average Rating</div>
            <div>{average.toFixed(1)}/5</div>
          </div>
          <div>
            <div className="muted">Total Evaluations</div>
            <div>{evaluations.length}</div>
          </div>
          <div>
            <div className="muted">Consecutive Excellent</div>
            <div>{streak === 0 ? '—' : streak}</div>
          </div>
          <div>
            <div className="muted">Latest Location</div>
            <div>{latestLocation}</div>
          </div>
        </div>

        <div className="profile-list">
          <h4>Latest evaluations</h4>
          {evaluations.slice(0, 10).map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="profile-item"
              onClick={() => onSelectFeedback(entry)}
            >
              <div>
                <div>{entry.clientLocation}</div>
                <div className="muted">{entry.comments ?? 'No comments'}</div>
              </div>
              <div>
                <div>{entry.overall.toFixed(1)}</div>
                <div className="muted">{new Date(entry.createdAt).toLocaleDateString('en-IE')}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>
          <span className="title-icon">⭐</span>
          Performance Overview
        </h2>
        <input
          type="search"
          placeholder="Search employee..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {debounced.length < 2 ? (
        <div className="grid-2 metric-grid">
          <div className="metric-card">
            <div className="muted">👥 Total employees</div>
            <div>{aggregate.totalEmployees}</div>
          </div>
          <div className="metric-card">
            <div className="muted">🧾 Total evaluations</div>
            <div>{aggregate.totalEvaluations}</div>
          </div>
          <div className="metric-card">
            <div className="muted">⭐ Average rating</div>
            <div>{aggregate.averageRating.toFixed(1)} ⭐</div>
          </div>
          <div className="metric-card">
            <div className="muted">🏆 Excellent ratings</div>
            <div>{aggregate.excellentCount}</div>
          </div>
        </div>
      ) : null}

      {debounced.length >= 2 ? (
        <div className="search-results">
          <div className="muted found-count">Found {matches.length}</div>
          {matches.map((employee) => (
            <button
              key={employee.name}
              type="button"
              className="result-row"
              onClick={() => {
                setSelectedEmployee(employee)
                setProfileOpen(true)
              }}
            >
              <span>{employee.name}</span>
              <span className="muted">{employee.evaluations.length} evaluations</span>
            </button>
          ))}
          {matches.length === 0 ? <div className="empty-state">No matches found.</div> : null}
        </div>
      ) : null}

      {mounted
        ? createPortal(
            <div
              className={`overlay${profileOpen ? ' active' : ''}`}
              onClick={(event) => {
                if (event.target === event.currentTarget) setProfileOpen(false)
              }}
            >
              <div className="overlay-sheet detail-sheet fade-up">
                <div className="sheet-header">
                  <h2>
                    <span className="title-icon">👤</span>
                    {selectedEmployee ? selectedEmployee.name : 'Employee Profile'}
                  </h2>
                  <button type="button" className="icon-btn" onClick={() => setProfileOpen(false)}>
                    ✕
                  </button>
                </div>
                {selectedEmployee ? renderProfile(selectedEmployee) : null}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
