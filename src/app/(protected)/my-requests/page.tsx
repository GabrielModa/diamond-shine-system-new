'use client'

import { useEffect, useState } from 'react'
import type { ApiResponse, SupplyRequest } from '../../../types'
import { timeAgo } from '../../../lib/business-logic'

export default function MyRequestsPage() {
  const [requests, setRequests] = useState<SupplyRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
          return (
            <article key={request.id} className="card request-history-card">
              <div className="request-history-header">
                <div><strong>{request.clientLocation}</strong><div className="muted">Submitted {timeAgo(request.createdAt)}</div></div>
                <span className={`status-badge ${request.status.replace(' ', '-')}`}>{request.status}</span>
              </div>
              <div className="request-items">{items.map((item) => <span key={item.product}>{item.product} × {item.quantity}</span>)}</div>
              <div className="request-progress" aria-label={`Request status: ${request.status}`}>
                {['Pending', 'Email Sent', 'Completed'].map((status, index) => {
                  const current = ['Pending', 'Email Sent', 'Completed'].indexOf(request.status)
                  return <div key={status} className={`progress-step${index <= current ? ' complete' : ''}`}><span />{status}</div>
                })}
              </div>
            </article>
          )
        })}
      </div>
    </main>
  )
}
