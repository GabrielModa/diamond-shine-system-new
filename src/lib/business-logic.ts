import type { UserRole, Page, FeedbackCategory, SupplyPriority, SupplyStatus } from '../types'
import { PAGE_ACCESS } from './constants'

export function calculateOverall(
  cleanliness: number,
  punctuality: number,
  equipment: number,
  clientRelations: number
): number {
  return (cleanliness + punctuality + equipment + clientRelations) / 4
}

export function getCategoryLabel(overall: number): FeedbackCategory {
  if (overall >= 4.6) return 'Excellent'
  if (overall >= 4.0) return 'Very Good'
  if (overall >= 3.0) return 'Good'
  if (overall >= 2.0) return 'Fair'
  return 'Poor'
}

export function isValidRating(value: number): boolean {
  return value >= 1.0 && value <= 5.0 && Number.isFinite(value) && value * 2 === Math.round(value * 2)
}

export function checkPageAccess(role: UserRole, page: Page): boolean {
  return PAGE_ACCESS[role]?.includes(page) ?? false
}

export function getAllowedPages(role: UserRole): Page[] {
  return PAGE_ACCESS[role] ?? []
}

export function formatDublinDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Dublin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('day')}/${get('month')}/${get('year')}, ${get('hour')}:${get('minute')}`
}

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000)
  if (Number.isNaN(diff) || diff < 0) return 'Just now'
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return date.toLocaleDateString('en-IE')
}

export function consecutiveExcellent(entries: Array<{ overall: number }>): number {
  let streak = 0
  for (const entry of entries) {
    if (entry.overall >= 4.6) {
      streak += 1
    } else {
      break
    }
  }
  return streak
}

export function getSupplySlaHours(priority: SupplyPriority): number {
  if (priority === 'urgent') return 24
  if (priority === 'normal') return 72
  return 168
}

export function calculateSupplyDueAt(priority: SupplyPriority, from = new Date()): Date {
  return new Date(from.getTime() + getSupplySlaHours(priority) * 60 * 60 * 1000)
}

export function isSupplyOverdue(
  dueAt: string | Date | null | undefined,
  status: SupplyStatus,
  now = new Date()
): boolean {
  if (!dueAt || status === 'Delivered' || status === 'Rejected' || status === 'Cancelled') return false
  const due = new Date(dueAt)
  return !Number.isNaN(due.getTime()) && due.getTime() < now.getTime()
}

type SupplyMetricInput = {
  status: SupplyStatus
  createdAt: string | Date
  completedAt?: string | Date | null
  dueAt?: string | Date | null
  assignedTo?: string | null
}

export function calculateSupplyOperationsMetrics(requests: SupplyMetricInput[]) {
  const terminal: SupplyStatus[] = ['Delivered', 'Rejected', 'Cancelled']
  const active = requests.filter((item) => !terminal.includes(item.status))
  const completedWithSla = requests.filter((item) => item.status === 'Delivered' && item.completedAt && item.dueAt)
  const completedOnTime = completedWithSla.filter(
    (item) => new Date(item.completedAt!).getTime() <= new Date(item.dueAt!).getTime()
  ).length
  const resolved = requests.filter((item) => item.status === 'Delivered' && item.completedAt)
  const averageResolutionHours = resolved.length
    ? resolved.reduce(
        (sum, item) => sum + Math.max(0, new Date(item.completedAt!).getTime() - new Date(item.createdAt).getTime()),
        0
      ) / resolved.length / 3_600_000
    : null

  return {
    unassignedCount: active.filter((item) => !item.assignedTo).length,
    slaRate: completedWithSla.length ? Math.round((completedOnTime / completedWithSla.length) * 100) : null,
    completedOnTime,
    completedWithSlaCount: completedWithSla.length,
    averageResolutionHours,
  }
}

const SUPPLY_TRANSITIONS: Record<SupplyStatus, SupplyStatus[]> = {
  Requested: ['Triaged', 'Rejected', 'Cancelled'],
  Triaged: ['Approved', 'Rejected', 'Cancelled'],
  Approved: ['Ordered', 'Cancelled'],
  Ordered: ['In transit', 'Cancelled'],
  'In transit': ['Delivered'],
  Delivered: [],
  Rejected: [],
  Cancelled: [],
}

export function getSupplyNextStatuses(status: SupplyStatus): SupplyStatus[] {
  return SUPPLY_TRANSITIONS[status]
}

export function canTransitionSupplyStatus(from: SupplyStatus, to: SupplyStatus): boolean {
  return SUPPLY_TRANSITIONS[from].includes(to)
}

export function calculateFeedbackTrend(
  entries: Array<{ overall: number; createdAt: string | Date }>,
  now = new Date()
) {
  const day = 24 * 60 * 60 * 1000
  const currentStart = now.getTime() - 30 * day
  const previousStart = now.getTime() - 60 * day
  const current = entries.filter((entry) => {
    const timestamp = new Date(entry.createdAt).getTime()
    return timestamp >= currentStart && timestamp <= now.getTime()
  })
  const previous = entries.filter((entry) => {
    const timestamp = new Date(entry.createdAt).getTime()
    return timestamp >= previousStart && timestamp < currentStart
  })
  const average = (items: typeof entries) => items.length
    ? items.reduce((sum, entry) => sum + entry.overall, 0) / items.length
    : null
  const currentAverage = average(current)
  const previousAverage = average(previous)

  return {
    currentCount: current.length,
    previousCount: previous.length,
    currentAverage,
    previousAverage,
    delta: currentAverage !== null && previousAverage !== null ? currentAverage - previousAverage : null,
  }
}
