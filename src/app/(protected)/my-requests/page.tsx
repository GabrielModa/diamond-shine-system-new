'use client'

import { useEffect, useState } from 'react'
import type { ApiResponse, SupplyRequest } from '../../../types'
import { isSupplyOverdue, timeAgo } from '../../../lib/business-logic'

export default function MyRequestsPage() {
  const [requests, setRequests] = useState<SupplyRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workingId, setWorkingId] = useState<string | null>(null)

  async function cancelRequest(request: SupplyRequest) {
    if (!window.confirm(`Cancel the request for ${request.clientLocation}?`)) return
    setWorkingId(request.id)
    const response = await fetch(`/api/supplies/${request.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'Cancelled' }),
    }).catch(() => null)
    setWorkingId(null)
    if (!response?.ok) {
      const payload = (await response?.json().catch(() => null)) as { error?: string } | null
      setError(payload?.error ?? 'Could not cancel request')
      return
    }
    setRequests((current) => current.map((item) => item.id === request.id ? { ...item, status: 'Cancelled' } : item))
  }

  function repeatRequest(request: SupplyRequest) {
    const items = request.items?.length ? request.items : request.products.map((product) => ({ product, quantity: 1 }))
    localStorage.setItem('ds-supplies-draft', JSON.stringify({
      name: request.employeeName,
      location: request.clientLocation,
      priority: request.priority,
      notes: request.notes ?? '',
      selected: items.map((item) => item.product),
      quantities: Object.fromEntries(items.map((item) => [item.product, item.quantity])),
    }))
    window.location.href = '/supplies'
  }

  useEffect(() => {
    fetch('/api/supplies?mine=true&limit=100', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json()) as ApiResponse<{ items: SupplyRequest[] }>
        if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error ?? 'Could not load requests')
        setRequests(payload.data.items)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load requests'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="page-shell">
      <header className="page-header page-header-action">
        <div>
          <h1>My Requests</h1>
          <p className="muted">Track every supply request you submitted.</p>
        </div>
        <a href="/supplies" className="btn-primary page-action">New request</a>
      </header>

      {loading ? <div className="card" role="status">Loading your requests…</div> : null}
      {error ? <div className="toast error" role="alert">{error}</div> : null}
      {!loading && !error && requests.length === 0 ? (
        <div className="card empty-state">
          <h2>No requests yet</h2>
          <p>Your submitted supply requests will appear here.</p>
          <a href="/supplies" className="btn-primary page-action">Create your first request</a>
        </div>
      ) : null}

      <div className="request-history">
        {requests.map((request) => {
          const items = request.items?.length
            ? request.items
            : request.products.map((product) => ({ product, quantity: 1 }))
          const overdue = isSupplyOverdue(request.dueAt, request.status)
          return (
            <article key={request.id} className="card request-history-card">
              <div className="request-history-header">
                <div><strong>{request.clientLocation}</strong><div className="muted">Submitted {timeAgo(request.createdAt)}</div></div>
                <div className="row tight"><span className={`status-badge ${request.status.replace(' ', '-')}`}>{request.status}</span>{overdue ? <span className="overdue-badge">Overdue</span> : null}</div>
              </div>
              {request.dueAt ? <div className={`due-label${overdue ? ' overdue' : ''}`}>Due {new Date(request.dueAt).toLocaleString('en-IE')}</div> : null}
              <div className="request-items">{items.map((item) => <span key={item.product}>{item.product} × {item.quantity}</span>)}</div>
              {request.status === 'Cancelled' ? <div className="request-cancelled">This request was cancelled.</div> : (
                <div className="request-progress" aria-label={`Request status: ${request.status}`}>
                {['Pending', 'Email Sent', 'Completed'].map((status, index) => {
                  const current = ['Pending', 'Email Sent', 'Completed'].indexOf(request.status)
                  return <div key={status} className={`progress-step${index <= current ? ' complete' : ''}`}><span />{status}</div>
                })}
                </div>
              )}
              {request.history?.length ? (
                <details className="request-history-details">
                  <summary>View status history ({request.history.length})</summary>
                  <div className="status-history compact">
                    {request.history.map((event) => (
                      <div key={event.id} className="status-history-event">
                        <span className="history-dot" />
                        <div><strong>{event.toStatus}</strong><div className="muted">{new Date(event.createdAt).toLocaleString('en-IE')}</div></div>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
              <div className="request-actions">
                <button type="button" className="btn-secondary" onClick={() => repeatRequest(request)}>Repeat request</button>
                {request.status === 'Pending' ? <button type="button" className="btn-ghost danger" disabled={workingId === request.id} onClick={() => void cancelRequest(request)}>{workingId === request.id ? 'Cancelling…' : 'Cancel request'}</button> : null}
              </div>
            </article>
          )
        })}
      </div>
    </main>
  )
}
