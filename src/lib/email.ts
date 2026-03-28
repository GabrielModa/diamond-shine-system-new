import nodemailer from 'nodemailer'
import { ADMIN_EMAIL, FEEDBACK_EMAIL } from './constants'

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

function getTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
      : undefined,
  })
}

function priorityEmoji(priority: SupplyEmailData['priority']): string {
  if (priority === 'urgent') return '🔴'
  if (priority === 'normal') return '🟡'
  return '🟢'
}

export async function sendSuppliesNotification(data: SupplyEmailData): Promise<void> {
  try {
    const transport = getTransport()
    await transport.sendMail({
      to: ADMIN_EMAIL,
      subject: `${priorityEmoji(data.priority)} SUPPLIES REQUEST - ${data.employeeName}`,
      html: `<p>${data.employeeName}</p><p>${data.clientLocation}</p>`,
    })
  } catch (error) {
    console.error('[EMAIL] failed supplies notification', error)
  }
}

export async function sendFeedbackNotification(data: FeedbackEmailData): Promise<void> {
  try {
    const transport = getTransport()
    await transport.sendMail({
      to: FEEDBACK_EMAIL,
      subject: `📋 FEEDBACK - ${data.employeeName}`,
      html: `<p>${data.employeeName}</p><p>${data.overall}</p>`,
    })
  } catch (error) {
    console.error('[EMAIL] failed feedback notification', error)
  }
}

export async function sendClientNotification(data: ClientEmailData): Promise<void> {
  try {
    const transport = getTransport()
    await transport.sendMail({ to: data.to, subject: data.subject, html: data.htmlBody })
  } catch (error) {
    console.error('[EMAIL] failed client notification', error)
  }
}
