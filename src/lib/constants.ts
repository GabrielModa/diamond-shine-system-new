import type { UserRole, Page } from '../types'

export const CLIENT_LOCATIONS = [
  'TechCorp Office - Dublin 2',
  'Green Bank - Temple Bar',
  'Blue Industries - Ballsbridge',
  'Red Company - Dun Laoghaire',
  'Other',
] as const

export const PRODUCTS = [
  { value: 'All-purpose cleaner', icon: '🧴' },
  { value: 'Toilet paper', icon: '🧻' },
  { value: 'Paper towels', icon: '📜' },
  { value: 'Vacuum bags', icon: '🌀' },
  { value: 'Microfiber cloths', icon: '🧽' },
  { value: 'Hand sanitizer', icon: '🧴' },
  { value: 'Bleach', icon: '🧪' },
  { value: 'Rubber gloves', icon: '🧤' },
  { value: 'Bin bags', icon: '🗑' },
] as const

export const RATING_VALUES = [5.0, 4.5, 4.0, 3.5, 3.0, 2.5, 2.0, 1.5, 1.0] as const

export const PAGE_ACCESS: Record<UserRole, Page[]> = {
  admin: ['home', 'clients', 'work-orders', 'operations', 'schedule', 'timesheets', 'field-control', 'quality', 'insights', 'people', 'supplies', 'my-requests', 'feedback', 'dashboard', 'users', 'communications', 'audit'],
  supervisor: ['home', 'clients', 'work-orders', 'operations', 'schedule', 'timesheets', 'field-control', 'quality', 'insights', 'people', 'supplies', 'my-requests', 'feedback', 'communications'],
  employee: ['home', 'schedule', 'timesheets', 'supplies', 'my-requests', 'communications'],
  viewer: ['home', 'clients', 'operations', 'schedule'],
}

export const ADMIN_EMAIL = process.env.SUPPLY_ADMIN_EMAIL ?? 'operations@diamondshine.local'
export const FEEDBACK_EMAIL = process.env.FEEDBACK_REVIEWER_EMAIL ?? 'quality@diamondshine.local'
export const SMTP_FROM = process.env.SMTP_FROM ?? 'Diamond Shine <noreply@diamondshine.ie>'
export const DUBLIN_TIMEZONE = 'Europe/Dublin'
