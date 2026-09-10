'use client'

import type { SupplyPriority, SupplyRequest, SupplyStatus } from '../../types'
import { calculateSupplyOperationsMetrics, isSupplyOverdue } from '../../lib/business-logic'
import OpsIcon from '../ui/OpsIcon'

type Preset = 'all' | 'overdue' | 'unassigned' | 'month'
type SupplyFilter = { status?: SupplyStatus; priority?: SupplyPriority; preset?: Preset }
type SupplyStatusIcon = 'review' | 'search' | 'check' | 'box' | 'truck' | 'alert'

function thisMonthCount(requests: SupplyRequest[]) {
  const now = new Date()
  return requests.filter((request) => {
    const date = new Date(request.createdAt)
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
  }).length
}

function mostRequested(requests: SupplyRequest[]) {
  const counts = new Map<string, number>()
  for (const request of requests) {
    for (const item of request.items?.length ? request.items : request.products.map((product) => ({ product, quantity: 1 }))) {
      counts.set(item.product, (counts.get(item.product) ?? 0) + item.quantity)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '—'
}

const STATUS: Array<{ value: SupplyStatus; label: string; icon: SupplyStatusIcon }> = [
  { value: 'Requested', label: 'Requested', icon: 'review' },
  { value: 'Triaged', label: 'Triaged', icon: 'search' },
  { value: 'Approved', label: 'Approved', icon: 'check' },
  { value: 'Ordered', label: 'Ordered', icon: 'box' },
  { value: 'In transit', label: 'In transit', icon: 'truck' },
  { value: 'Delivered', label: 'Delivered', icon: 'check' },
  { value: 'Rejected', label: 'Rejected', icon: 'alert' },
  { value: 'Cancelled', label: 'Cancelled', icon: 'alert' },
]

export default function SupplyOperationsOverview({
  requests,
  filter,
  onFilter,
}: {
  requests: SupplyRequest[]
  filter: SupplyFilter
  onFilter: (filter: SupplyFilter) => void
}) {
  const requested = requests.filter((request) => request.status === 'Requested')
  const operations = calculateSupplyOperationsMetrics(requests)
  const overdue = requests.filter((request) => isSupplyOverdue(request.dueAt, request.status)).length
  const topProduct = mostRequested(requests)

  return <section className="supply-ops-overview" aria-labelledby="supply-control-title">
    <div className="supply-ops-heading">
      <div className="section-icon-tile"><OpsIcon name="box" size={19} /></div>
      <div><h2 id="supply-control-title">Supply requests</h2><p>Prioritise what arrived from the field, then move each request through procurement.</p></div>
    </div>

    <div className="supply-priority-grid" aria-label="New requests by priority">
      {(['urgent', 'normal', 'low'] as const).map((priority) => {
        const count = requested.filter((request) => request.priority === priority).length
        const active = filter.status === 'Requested' && filter.priority === priority
        return <button type="button" key={priority} className={active ? 'active' : ''} data-priority={priority} aria-pressed={active} onClick={() => onFilter(active ? {} : { status: 'Requested', priority })}>
          <span>{priority}</span><strong>{count}</strong><small>new request{count === 1 ? '' : 's'}</small>
        </button>
      })}
    </div>

    <div className="supply-status-strip" role="group" aria-label="Supply request status">
      <button type="button" className={!filter.status && !filter.priority && !filter.preset ? 'active' : ''} onClick={() => onFilter({})}><OpsIcon name="review" size={15} />All <b>{requests.length}</b></button>
      {STATUS.map((item) => {
        const count = requests.filter((request) => request.status === item.value).length
        const active = filter.status === item.value && !filter.priority
        return <button type="button" className={active ? 'active' : ''} key={item.value} aria-pressed={active} onClick={() => onFilter(active ? {} : { status: item.value })}>
          <OpsIcon name={item.icon} size={15} />{item.label} <b>{count}</b>
        </button>
      })}
    </div>

    <div className="supply-ops-metrics">
      <button type="button" className={filter.preset === 'overdue' ? 'active' : ''} onClick={() => onFilter(filter.preset === 'overdue' ? {} : { preset: 'overdue' })}><OpsIcon name="alert" /><span>Overdue</span><strong>{overdue}</strong></button>
      <button type="button" className={filter.preset === 'unassigned' ? 'active' : ''} onClick={() => onFilter(filter.preset === 'unassigned' ? {} : { preset: 'unassigned' })}><OpsIcon name="user" /><span>Unassigned</span><strong>{operations.unassignedCount}</strong></button>
      <button type="button" className={filter.preset === 'month' ? 'active' : ''} onClick={() => onFilter(filter.preset === 'month' ? {} : { preset: 'month' })}><OpsIcon name="calendar" /><span>This month</span><strong>{thisMonthCount(requests)}</strong></button>
      <article><OpsIcon name="star" /><span>Most requested</span><strong>{topProduct}</strong></article>
      <article><OpsIcon name="check" /><span>SLA compliance</span><strong>{operations.slaRate == null ? '—' : operations.slaRate + '%'}</strong><small>{operations.completedWithSlaCount ? operations.completedOnTime + ' of ' + operations.completedWithSlaCount + ' delivered on time' : 'No delivered requests with SLA yet'}</small></article>
      <article><OpsIcon name="clock" /><span>Average resolution</span><strong>{operations.averageResolutionHours == null ? '—' : operations.averageResolutionHours < 24 ? operations.averageResolutionHours.toFixed(1) + 'h' : (operations.averageResolutionHours / 24).toFixed(1) + 'd'}</strong><small>Request to delivery</small></article>
    </div>
  </section>
}
