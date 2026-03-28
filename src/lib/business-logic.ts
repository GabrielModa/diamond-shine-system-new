import type { UserRole, Page, FeedbackCategory } from '../types'
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
