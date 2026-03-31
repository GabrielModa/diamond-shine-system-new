import nodemailer from 'nodemailer'
import { ADMIN_EMAIL, FEEDBACK_EMAIL, SMTP_FROM } from './constants'
import { prisma } from './prisma'

export interface SupplyEmailData {
  id: string
  employeeName: string
  clientLocation: string
  priority: 'urgent' | 'normal' | 'low'
  products: string[]
  notes?: string
  submittedBy: string
  createdAt?: Date | string
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
  createdAt?: Date | string
}

export interface ClientEmailData {
  to: string
  subject: string
  htmlBody: string
}

export interface InviteEmailData {
  to: string
  name: string
  tempPassword: string
  inviteUrl: string
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

function priorityConfig(priority: SupplyEmailData['priority']) {
  if (priority === 'urgent') return { emoji: '🔴', color: '#dc3545', bg: '#fff5f5', label: 'URGENT' }
  if (priority === 'normal') return { emoji: '🟡', color: '#ffc107', bg: '#fffbeb', label: 'NORMAL' }
  return { emoji: '🟢', color: '#28a745', bg: '#f0fff4', label: 'LOW' }
}

function formatDublinDate(value?: Date | string) {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-IE', { timeZone: 'Europe/Dublin' })
}

function buildSuppliesEmailHtml(data: SupplyEmailData): string {
  const config = priorityConfig(data.priority)
  const productsHtml = (data.products || []).map((p) => `<div class="product-item">• ${p}</div>`).join('')
  const notesRow = data.notes ? `<tr><td>Notes</td><td>${data.notes}</td></tr>` : ''
  const timestamp = formatDublinDate(data.createdAt)

  return `<!DOCTYPE html>
  <html lang="en-IE">
  <head>
    <meta charset="UTF-8">
    <style>
      body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; margin:0; padding:20px; background:linear-gradient(135deg,#f5f7fa 0%,#c3cfe2 100%); line-height:1.6; }
      .container { max-width:600px; margin:0 auto; background:white; border-radius:12px; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.1); }
      .header { background:linear-gradient(135deg,#667eea,#764ba2); color:white; padding:30px 20px; text-align:center; }
      .header h1 { margin:0; font-size:2rem; font-weight:700; }
      .priority-banner { padding:20px; margin:20px; border-radius:10px; border-left:4px solid ${config.color}; background:${config.bg}; }
      .priority-banner h2 { margin:0; color:${config.color}; font-size:1.3rem; display:flex; align-items:center; gap:10px; }
      .info-card { margin:20px; background:#f8f9fa; border-radius:10px; overflow:hidden; }
      .info-table { width:100%; border-collapse:collapse; }
      .info-table td { padding:12px 16px; border-bottom:1px solid #e9ecef; }
      .info-table td:first-child { font-weight:600; color:#495057; width:140px; }
      .products-list { background:white; padding:10px; border-radius:6px; border:1px solid #dee2e6; }
      .product-item { padding:4px 0; border-bottom:1px solid #f8f9fa; }
      .product-item:last-child { border-bottom:none; }
      .footer { background:#f8f9fa; padding:20px; text-align:center; color:#6c757d; font-size:0.875rem; border-top:1px solid #dee2e6; }
      .pill { background:${config.color}; color:white; padding:4px 8px; border-radius:6px; font-family: ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace; font-size:0.85rem; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>💎 Diamond Shine</h1>
        <p>Supplies Management System</p>
      </div>
      <div class="priority-banner">
        <h2>${config.emoji} ${config.label} PRIORITY <span class="pill">${data.id}</span></h2>
      </div>
      <div class="info-card">
        <table class="info-table">
          <tr><td>Employee</td><td><strong>${data.employeeName}</strong></td></tr>
          <tr><td>Location</td><td>${data.clientLocation}</td></tr>
          <tr><td>Products</td><td><div class="products-list">${productsHtml}</div></td></tr>
          ${notesRow}
          <tr><td>Submitted by</td><td>${data.submittedBy}</td></tr>
          <tr><td>Date/Time</td><td>${timestamp}</td></tr>
        </table>
      </div>
      <div class="footer">
        Request ID: <b>${data.id}</b> | Diamond Shine Automated System
      </div>
    </div>
  </body>
  </html>`
}

function buildFeedbackEmailHtml(data: FeedbackEmailData): string {
  const timestamp = formatDublinDate(data.createdAt)
  return `<!DOCTYPE html>
  <html lang="en-IE">
  <head>
    <meta charset="UTF-8">
    <style>
      body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; margin:0; padding:20px; background:linear-gradient(135deg,#f5f7fa 0%,#c3cfe2 100%); line-height:1.6; }
      .container { max-width:600px; margin:0 auto; background:white; border-radius:12px; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.1); }
      .header { background:linear-gradient(135deg,#667eea,#764ba2); color:white; padding:30px 20px; text-align:center; }
      .header h1 { margin:0; font-size:2rem; font-weight:700; }
      .score-card { margin:20px; background:#f8f9fa; border-radius:10px; overflow:hidden; }
      .score-table { width:100%; border-collapse:collapse; }
      .score-table td { padding:12px 16px; border-bottom:1px solid #e9ecef; }
      .score-table td:first-child { font-weight:600; color:#495057; width:160px; }
      .footer { background:#f8f9fa; padding:20px; text-align:center; color:#6c757d; font-size:0.875rem; border-top:1px solid #dee2e6; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>💎 Diamond Shine</h1>
        <p>Supervisor Feedback</p>
      </div>
      <div class="score-card">
        <table class="score-table">
          <tr><td>Employee</td><td><strong>${data.employeeName}</strong></td></tr>
          <tr><td>Location</td><td>${data.clientLocation}</td></tr>
          <tr><td>Cleanliness</td><td>${data.cleanliness}</td></tr>
          <tr><td>Punctuality</td><td>${data.punctuality}</td></tr>
          <tr><td>Equipment</td><td>${data.equipment}</td></tr>
          <tr><td>Client Relations</td><td>${data.clientRelations}</td></tr>
          <tr><td>Overall</td><td><b>${data.overall.toFixed(1)}</b> (${data.category})</td></tr>
          <tr><td>Comments</td><td>${data.comments ?? ''}</td></tr>
          <tr><td>Submitted by</td><td>${data.submittedBy}</td></tr>
          <tr><td>Date/Time</td><td>${timestamp}</td></tr>
        </table>
      </div>
      <div class="footer">
        Feedback ID: <b>${data.id}</b> | Diamond Shine Automated System
      </div>
    </div>
  </body>
  </html>`
}

async function getRecipients(key: 'supply_alerts' | 'feedback_alerts', fallback: string): Promise<string[]> {
  try {
    const record = await prisma.notificationSetting.findUnique({ where: { key } })
    const value = record?.recipients?.trim() || fallback
    return value
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean)
  } catch {
    return fallback.split(',').map((email) => email.trim()).filter(Boolean)
  }
}

export async function sendSuppliesNotification(data: SupplyEmailData): Promise<void> {
  try {
    const transport = getTransport()
    const recipients = await getRecipients('supply_alerts', ADMIN_EMAIL)
    await transport.sendMail({
      from: SMTP_FROM,
      to: recipients,
      subject: `${priorityEmoji(data.priority)} SUPPLIES REQUEST - ${data.employeeName} (ID: ${data.id})`,
      html: buildSuppliesEmailHtml(data),
    })
  } catch (error) {
    console.error('[EMAIL] failed supplies notification', error)
  }
}

export async function sendFeedbackNotification(data: FeedbackEmailData): Promise<void> {
  try {
    const transport = getTransport()
    const recipients = await getRecipients('feedback_alerts', FEEDBACK_EMAIL)
    await transport.sendMail({
      from: SMTP_FROM,
      to: recipients,
      subject: `📋 FEEDBACK - ${data.employeeName} (ID: ${data.id})`,
      html: buildFeedbackEmailHtml(data),
    })
  } catch (error) {
    console.error('[EMAIL] failed feedback notification', error)
  }
}

export async function sendClientNotification(
  data: ClientEmailData
): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = getTransport()
    await transport.sendMail({ from: SMTP_FROM, to: data.to, subject: data.subject, html: data.htmlBody })
    return { ok: true }
  } catch (error) {
    console.error('[EMAIL] failed client notification', error)
    return { ok: false, error: error instanceof Error ? error.message : 'SMTP error' }
  }
}

const INVITE_TEMPLATE_FALLBACK = {
  subject: 'You are invited to Diamond Shine',
  body: `<p>Hello {{name}},</p>
<p>You have been invited to Diamond Shine. Use the temporary password below to log in:</p>
<p><b>Password:</b> {{tempPassword}}</p>
<p>Login here: <a href="{{inviteUrl}}">{{inviteUrl}}</a></p>
<p>If you did not request this, please ignore this email.</p>`,
}

function renderTemplate(template: { subject: string; body: string }, data: Record<string, string>) {
  const replace = (value: string) =>
    Object.entries(data).reduce((acc, [key, val]) => acc.replaceAll(`{{${key}}}`, val), value)
  return { subject: replace(template.subject), body: replace(template.body) }
}

async function getTemplate(key: string) {
  try {
    const template = await prisma.emailTemplate.findUnique({ where: { key } })
    if (!template) return null
    return { subject: template.subject, body: template.body }
  } catch {
    return null
  }
}

export async function sendUserInvite(data: InviteEmailData): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = getTransport()
    const template = (await getTemplate('user_invite')) ?? INVITE_TEMPLATE_FALLBACK
    const rendered = renderTemplate(template, {
      name: data.name,
      email: data.to,
      tempPassword: data.tempPassword,
      inviteUrl: data.inviteUrl,
    })
    await transport.sendMail({
      from: SMTP_FROM,
      to: data.to,
      subject: rendered.subject,
      html: rendered.body,
    })
    return { ok: true }
  } catch (error) {
    console.error('[EMAIL] failed invite email', error)
    return { ok: false, error: error instanceof Error ? error.message : 'SMTP error' }
  }
}
