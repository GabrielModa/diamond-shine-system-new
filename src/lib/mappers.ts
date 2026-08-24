import type { FeedbackCategory, SupplyStatus } from '../types'

export type DbSupplyStatus = 'Requested' | 'Triaged' | 'Approved' | 'Ordered' | 'InTransit' | 'Delivered' | 'Rejected' | 'Cancelled'
type LegacyDbSupplyStatus = 'Pending' | 'EmailSent' | 'Completed'

export function dbStatusToLabel(status: DbSupplyStatus | LegacyDbSupplyStatus): SupplyStatus {
  if (status === 'Pending') return 'Requested'
  if (status === 'EmailSent') return 'Approved'
  if (status === 'Completed') return 'Delivered'
  if (status === 'InTransit') return 'In transit'
  return status
}

export function labelToDbStatus(status: SupplyStatus): DbSupplyStatus {
  if (status === 'In transit') return 'InTransit'
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
