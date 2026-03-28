'use client'

import { useMemo, useState } from 'react'
import type { FeedbackEntry, SupplyRequest } from '../../types'
import { timeAgo } from '../../lib/business-logic'

type ActivityFeedProps = {
  supplies: SupplyRequest[]
  feedback: FeedbackEntry[]
  onSelectSupply: (request: SupplyRequest) => void
  onSelectFeedback: (entry: FeedbackEntry) => void
}

type ActivityItem =
  | { type: 'supply'; date: string; request: SupplyRequest }
  | { type: 'feedback'; date: string; entry: FeedbackEntry }

function ratingColor(overall: number): string {
  if (overall >= 4.6) return 'rating-good'
  if (overall >= 4.0) return 'rating-info'
  return 'rating-warn'
}

export function ActivityFeed({ supplies, feedback, onSelectSupply, onSelectFeedback }: ActivityFeedProps) {
  const [segment, setSegment] = useState<'all' | 'supplies' | 'feedback'>('all')

  const items = useMemo(() => {
    const list: ActivityItem[] = [
      ...supplies.map((request) => ({ type: 'supply' as const, date: request.createdAt, request })),
      ...feedback.map((entry) => ({ type: 'feedback' as const, date: entry.createdAt, entry })),
    ]
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5)
  }, [supplies, feedback])

  const filtered = items.filter((item) => {
    if (segment === 'all') return true
    if (segment === 'supplies') return item.type === 'supply'
    return item.type === 'feedback'
  })

  return (
    <div className="card">
      <div className="card-header">
        <h2>
          <span className="title-icon">🧭</span>
          Recent Activity
        </h2>
        <div className="segmented">
          {(['all', 'supplies', 'feedback'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`seg-btn${segment === item ? ' active' : ''}`}
              onClick={() => setSegment(item)}
            >
              {item === 'all' ? 'All' : item === 'supplies' ? 'Supplies' : 'Feedback'}
            </button>
          ))}
        </div>
      </div>

      <div className="activity-list">
        {filtered.length === 0 ? <div className="empty-state">No activity yet.</div> : null}
        {filtered.map((item) =>
          item.type === 'supply' ? (
            <button key={item.request.id} type="button" className="activity-row" onClick={() => onSelectSupply(item.request)}>
              <span className="activity-icon">📦</span>
              <div className="activity-main">
                <div>{item.request.employeeName}</div>
                <div className="muted">
                  {item.request.clientLocation} ·{' '}
                  <span className={`priority-text ${item.request.priority}`}>{item.request.priority.toUpperCase()}</span> ·{' '}
                  {timeAgo(item.request.createdAt)}
                </div>
              </div>
            </button>
          ) : (
            <button key={item.entry.id} type="button" className="activity-row" onClick={() => onSelectFeedback(item.entry)}>
              <span className="activity-icon">⭐</span>
              <div className="activity-main">
                <div>{item.entry.employeeName}</div>
                <div className="muted">
                  Rating:{' '}
                  <span className={ratingColor(item.entry.overall)}>{item.entry.overall.toFixed(1)} ({item.entry.category})</span> ·{' '}
                  {timeAgo(item.entry.createdAt)}
                </div>
              </div>
            </button>
          )
        )}
      </div>
    </div>
  )
}
