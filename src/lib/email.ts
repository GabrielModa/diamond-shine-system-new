export interface SupplyEmailData {
  id: string
  employeeName: string
  clientLocation: string
  priority: 'urgent' | 'normal' | 'low'
  products: string[]
  notes?: string
  submittedBy: string
}

export interface FeedbackEmailData {
  id: string
  employeeName: string
  clientLocation: string
  cleanliness: number
  punctuality: number
  equipment: number
  clientRelations: number
  overall: number
  category: string
  comments?: string
  submittedBy: string
}

export interface ClientEmailData {
  to: string
  subject: string
  htmlBody: string
}

export async function sendSuppliesNotification(data: SupplyEmailData): Promise<void> {
  void data
  throw new Error('not implemented')
}

export async function sendFeedbackNotification(data: FeedbackEmailData): Promise<void> {
  void data
  throw new Error('not implemented')
}

export async function sendClientNotification(data: ClientEmailData): Promise<void> {
  void data
  throw new Error('not implemented')
}
