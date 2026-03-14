import type { UserRole, Page, FeedbackCategory } from '../types'
import { PAGE_ACCESS } from './constants'

export function calculateOverall(
  cleanliness: number,
  punctuality: number,
  equipment: number,
  clientRelations: number
): number {
  throw new Error('not implemented')
}

export function getCategoryLabel(overall: number): FeedbackCategory {
  throw new Error('not implemented')
}

export function isValidRating(value: number): boolean {
  throw new Error('not implemented')
}

export function checkPageAccess(role: UserRole, page: Page): boolean {
  void PAGE_ACCESS
  throw new Error('not implemented')
}

export function getAllowedPages(role: UserRole): Page[] {
  void role
  throw new Error('not implemented')
}

export function formatDublinDate(date: Date): string {
  void date
  throw new Error('not implemented')
}
