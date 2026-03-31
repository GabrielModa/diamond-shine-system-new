'use client'

import type { SupplyPriority, SupplyRequest, SupplyStatus } from '../../types'

type SuppliesStatsProps = {
  requests: SupplyRequest[]
  mostRequestedProduct: string
  activeFilter?: { priority?: SupplyPriority; status?: SupplyStatus }
  newCount?: number
  onOpenList: (
    filter: { priority?: SupplyPriority; status?: SupplyStatus },
    title: string,
    preset?: { period?: 'all' | '7' | '30' | '90' | 'month'; search?: string }
  ) => void
}

function countThisMonth(requests: SupplyRequest[]) {
  const now = new Date()
  const month = now.getMonth()
  const year = now.getFullYear()
  return requests.filter((item) => {
    const date = new Date(item.createdAt)
    return date.getMonth() === month && date.getFullYear() === year
  }).length
}

export function SuppliesStats({ requests, mostRequestedProduct, activeFilter, newCount = 0, onOpenList }: SuppliesStatsProps) {
  const pending = requests.filter((item) => item.status === 'Pending')
  const urgentCount = pending.filter((item) => item.priority === 'urgent').length
  const normalCount = pending.filter((item) => item.priority === 'normal').length
  const lowCount = pending.filter((item) => item.priority === 'low').length

  const statusCounts = {
    all: requests.length,
    pending: pending.length,
    emailSent: requests.filter((item) => item.status === 'Email Sent').length,
    completed: requests.filter((item) => item.status === 'Completed').length,
  }

  return (
      <div className="card supplies-card">
        <div className="card-header">
          <div>
            <h2>
              <span className="title-icon">📦</span>
              Supplies Control
            </h2>
            <div className="muted">Pending requests by priority</div>
          </div>
          {newCount > 0 ? <span className="new-pill">+{newCount} new</span> : null}
        </div>

      <div className="stat-grid">
        <button
          type="button"
          className="stat-card urgent"
          data-testid="stat-urgent"
          onClick={() => onOpenList({ priority: 'urgent', status: 'Pending' }, 'URGENT Requests')}
        >
          <div className="stat-label">Urgent</div>
          <div className="stat-value">{urgentCount}</div>
        </button>
        <button
          type="button"
          className="stat-card normal"
          data-testid="stat-normal"
          onClick={() => onOpenList({ priority: 'normal', status: 'Pending' }, 'NORMAL Requests')}
        >
          <div className="stat-label">Normal</div>
          <div className="stat-value">{normalCount}</div>
        </button>
        <button
          type="button"
          className="stat-card low"
          data-testid="stat-low"
          onClick={() => onOpenList({ priority: 'low', status: 'Pending' }, 'LOW Requests')}
        >
          <div className="stat-label">Low</div>
          <div className="stat-value">{lowCount}</div>
        </button>
      </div>

      <div className="row status-row">
        <button
          type="button"
          className={`status-pill${!activeFilter?.status && !activeFilter?.priority ? ' active' : ''}`}
          onClick={() => onOpenList({}, `All Requests`)}
        >
          🗂 All [{statusCounts.all}]
        </button>
        <button
          type="button"
          className={`status-pill${activeFilter?.status === 'Pending' ? ' active' : ''}`}
          onClick={() => onOpenList({ status: 'Pending' }, `Pending Requests`)}
        >
          ⏳ Pending [{statusCounts.pending}]
        </button>
        <button
          type="button"
          className={`status-pill${activeFilter?.status === 'Email Sent' ? ' active' : ''}`}
          onClick={() => onOpenList({ status: 'Email Sent' }, `Email Sent Requests`)}
        >
          📧 Email Sent [{statusCounts.emailSent}]
        </button>
        <button
          type="button"
          className={`status-pill${activeFilter?.status === 'Completed' ? ' active' : ''}`}
          onClick={() => onOpenList({ status: 'Completed' }, `Done Requests`)}
        >
          ✅ Done [{statusCounts.completed}]
        </button>
      </div>

      <div className="metrics-row">
        <button
          type="button"
          className="metric-card action"
          onClick={() => onOpenList({}, 'All Requests', { period: 'all' })}
        >
          <div className="muted">📊 Total Requests</div>
          <div>{requests.length}</div>
        </button>
        <button
          type="button"
          className="metric-card action"
          onClick={() => onOpenList({}, 'Requests This Month', { period: 'month' })}
        >
          <div className="muted">🗓 This month</div>
          <div>{countThisMonth(requests)}</div>
        </button>
        <button
          type="button"
          className="metric-card action"
          onClick={() =>
            onOpenList({}, `Most Requested: ${mostRequestedProduct || '—'}`, {
              search: mostRequestedProduct || '',
            })
          }
          disabled={!mostRequestedProduct}
        >
          <div className="muted">⭐ Most requested</div>
          <div>{mostRequestedProduct || '—'}</div>
        </button>
      </div>
    </div>
  )
}
