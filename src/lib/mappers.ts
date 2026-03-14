import type { FeedbackCategory, SupplyStatus } from '../types'

export function dbStatusToLabel(status: 'Pending' | 'EmailSent' | 'Completed'): SupplyStatus {
  if (status === 'EmailSent') return 'Email Sent'
  return status
}

export function labelToDbStatus(status: SupplyStatus): 'Pending' | 'EmailSent' | 'Completed' {
  if (status === 'Email Sent') return 'EmailSent'
  return status
}

export function dbCategoryToLabel(category: 'Excellent' | 'VeryGood' | 'Good' | 'Fair' | 'Poor'): FeedbackCategory {
  if (category === 'VeryGood') return 'Very Good'
  return category
}

export function labelToDbCategory(category: FeedbackCategory): 'Excellent' | 'VeryGood' | 'Good' | 'Fair' | 'Poor' {
  if (category === 'Very Good') return 'VeryGood'
  return category
}
