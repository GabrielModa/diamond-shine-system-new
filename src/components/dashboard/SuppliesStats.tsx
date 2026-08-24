'use client'

import type { SupplyPriority, SupplyRequest, SupplyStatus } from '../../types'
import { calculateSupplyOperationsMetrics, isSupplyOverdue } from '../../lib/business-logic'

type SuppliesStatsProps = {
  requests: SupplyRequest[]
  mostRequestedProduct: string
  activeFilter?: { priority?: SupplyPriority; status?: SupplyStatus }
  newCount?: number
  onOpenList: (
    filter: { priority?: SupplyPriority; status?: SupplyStatus },
    title: string,
    preset?: { period?: 'all' | '7' | '30' | '90' | 'month'; search?: string; overdue?: boolean; unassigned?: boolean }
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
  const requested = requests.filter((item) => item.status === 'Requested')
  const urgentCount = requested.filter((item) => item.priority === 'urgent').length
  const normalCount = requested.filter((item) => item.priority === 'normal').length
  const lowCount = requested.filter((item) => item.priority === 'low').length

  const statusOptions: Array<{ status: SupplyStatus; icon: string }> = [
    { status: 'Requested', icon: '🆕' },
    { status: 'Triaged', icon: '🔎' },
    { status: 'Approved', icon: '👍' },
    { status: 'Ordered', icon: '🛒' },
    { status: 'In transit', icon: '🚚' },
    { status: 'Delivered', icon: '✅' },
    { status: 'Rejected', icon: '⛔' },
    { status: 'Cancelled', icon: '✕' },
  ]
  const overdueCount = requests.filter((item) => isSupplyOverdue(item.dueAt, item.status)).length
  const { unassignedCount, slaRate, completedOnTime, completedWithSlaCount, averageResolutionHours } = calculateSupplyOperationsMetrics(requests)

  return (
      <div className="card supplies-card">
        <div className="card-header">
          <div>
            <h2>
              <span className="title-icon">📦</span>
              Supplies Control
            </h2>
            <div className="muted">New requests by priority</div>
          </div>
          {newCount > 0 ? <span className="new-pill">+{newCount} new</span> : null}
        </div>

      <div className="stat-grid">
        <button
          type="button"
          className="stat-card urgent"
          data-testid="stat-urgent"
          onClick={() => onOpenList({ priority: 'urgent', status: 'Requested' }, 'URGENT New Requests')}
        >
          <div className="stat-label">Urgent</div>
          <div className="stat-value">{urgentCount}</div>
        </button>
        <button
          type="button"
          className="stat-card normal"
          data-testid="stat-normal"
          onClick={() => onOpenList({ priority: 'normal', status: 'Requested' }, 'NORMAL New Requests')}
        >
          <div className="stat-label">Normal</div>
          <div className="stat-value">{normalCount}</div>
        </button>
        <button
          type="button"
          className="stat-card low"
          data-testid="stat-low"
          onClick={() => onOpenList({ priority: 'low', status: 'Requested' }, 'LOW New Requests')}
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
          🗂 All [{requests.length}]
        </button>
        {statusOptions.map(({ status, icon }) => (
          <button
            key={status}
            type="button"
            className={`status-pill${activeFilter?.status === status ? ' active' : ''}`}
            onClick={() => onOpenList({ status }, `${status} Requests`)}
          >
            {icon} {status} [{requests.filter((item) => item.status === status).length}]
          </button>
        ))}
      </div>

      <div className="metrics-row">
        <button
          type="button"
          className="metric-card action"
          onClick={() => onOpenList({}, 'Overdue Requests', { overdue: true })}
        >
          <div className="muted">⚠️ Overdue</div>
          <div>{overdueCount}</div>
        </button>
        <button
          type="button"
          className="metric-card action"
          onClick={() => onOpenList({}, 'Unassigned Active Requests', { unassigned: true })}
        >
          <div className="muted">👤 Unassigned</div>
          <div>{unassignedCount}</div>
        </button>
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
        <div className="metric-card operational-kpi">
          <div className="muted">🎯 SLA compliance</div>
          <div>{slaRate === null ? '—' : `${slaRate}%`}</div>
          <small>{completedWithSlaCount ? `${completedOnTime} of ${completedWithSlaCount} delivered on time` : 'No delivered requests yet'}</small>
        </div>
        <div className="metric-card operational-kpi">
          <div className="muted">⏱ Average resolution</div>
          <div>{averageResolutionHours === null ? '—' : averageResolutionHours < 24 ? `${averageResolutionHours.toFixed(1)}h` : `${(averageResolutionHours / 24).toFixed(1)}d`}</div>
          <small>From request to delivery</small>
        </div>
      </div>
    </div>
  )
}
