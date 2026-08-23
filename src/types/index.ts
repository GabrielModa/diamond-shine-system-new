export type UserRole = 'admin' | 'supervisor' | 'employee' | 'viewer'
export type Page = 'home' | 'clients' | 'work-orders' | 'operations' | 'schedule' | 'timesheets' | 'field-control' | 'quality' | 'insights' | 'supplies' | 'my-requests' | 'feedback' | 'dashboard' | 'users' | 'communications' | 'audit'
export type SupplyPriority = 'urgent' | 'normal' | 'low'
export type SupplyStatus =
  | 'Requested'
  | 'Triaged'
  | 'Approved'
  | 'Ordered'
  | 'In transit'
  | 'Delivered'
  | 'Rejected'
  | 'Cancelled'
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
  items?: Array<{ product: string; quantity: number }>
  notes?: string
  status: SupplyStatus
  submittedBy: string
  emailSentAt?: string
  completedAt?: string
  dueAt?: string
  assignedTo?: string
  history?: Array<{
    id: string
    fromStatus?: string | null
    toStatus: SupplyStatus
    actorEmail: string
    note?: string | null
    createdAt: string
  }>
}

export interface FeedbackEntry {
  id: string
  createdAt: string
  employeeName: string
  employeeId?: string
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
