import type { UserRole, Page, FeedbackCategory } from '../types'
import { DUBLIN_TIMEZONE, PAGE_ACCESS, RATING_VALUES } from './constants'

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
  return (RATING_VALUES as readonly number[]).includes(value)
}

export function checkPageAccess(role: UserRole, page: Page): boolean {
  return PAGE_ACCESS[role]?.includes(page) ?? false
}

export function getAllowedPages(role: UserRole): Page[] {
  return PAGE_ACCESS[role] ?? []
}

export function formatDublinDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DUBLIN_TIMEZONE,
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
