export type UserRole = 'admin' | 'supervisor' | 'employee' | 'viewer'
export type Page = 'home' | 'supplies' | 'feedback' | 'dashboard'
export type SupplyPriority = 'urgent' | 'normal' | 'low'
export type SupplyStatus = 'Pending' | 'Email Sent' | 'Completed'
export type FeedbackCategory = 'Excellent' | 'Very Good' | 'Good' | 'Fair' | 'Poor'

export interface ApiResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  code?: string
}

export interface SupplyRequest {
  id: string
  createdAt: string
  employeeName: string
  clientLocation: string
  priority: SupplyPriority
  products: string[]
  notes?: string
  status: SupplyStatus
  submittedBy: string
  emailSentAt?: string
  completedAt?: string
}

export interface FeedbackEntry {
  id: string
  createdAt: string
  employeeName: string
  clientLocation: string
  cleanliness: number
  punctuality: number
  equipment: number
  clientRelations: number
  overall: number
  category: FeedbackCategory
  comments?: string
  submittedBy: string
}
