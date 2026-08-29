import nodemailer from 'nodemailer'
import { ADMIN_EMAIL, FEEDBACK_EMAIL, SMTP_FROM } from './constants'
import { prisma } from './prisma'
import { LEGACY_ORGANIZATION_ID } from './tenancy'
import { getSmtpConfig } from './runtime-config'

export interface SupplyEmailData {
  id: string
  employeeName: string
  clientLocation: string
  priority: 'urgent' | 'normal' | 'low'
  products: string[]
  items?: Array<{ product: string; quantity: number }>
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
  inviteUrl: string
}

export interface QualityEmailData {
  inspectionId?: string
  actionId?: string
  siteName: string
  clientName: string
  score?: number
  grade?: string
  correctiveActions?: number
  title?: string
  status?: string
  severity?: string
  assignedTo?: string
}

export interface PasswordResetEmailData {
  to: string
  name: string
  resetUrl: string
}

export interface ProfileChangeEmailData {
  to: string[]
  employeeName: string
  changes: string[]
  summary: string
  createdAt?: Date | string
}

function getTransport() {
  if (process.env.EMAIL_TRANSPORT === 'json') {
    return nodemailer.createTransport({ jsonTransport: true })
  }
  return nodemailer.createTransport(getSmtpConfig())
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character] ?? character))
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function buildSuppliesEmailHtml(data: SupplyEmailData): string {
  const config = priorityConfig(data.priority)
  const items = data.items?.length ? data.items : (data.products || []).map((product) => ({ product, quantity: 1 }))
  const productsHtml = items.map((item) => `<div class="product-item">• ${escapeHtml(item.product)} × ${item.quantity}</div>`).join('')
  const notesRow = data.notes ? `<tr><td>Notes</td><td>${escapeHtml(data.notes)}</td></tr>` : ''
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
        <h2>${config.emoji} ${config.label} PRIORITY <span class="pill">${escapeHtml(data.id)}</span></h2>
      </div>
      <div class="info-card">
        <table class="info-table">
          <tr><td>Employee</td><td><strong>${escapeHtml(data.employeeName)}</strong></td></tr>
          <tr><td>Location</td><td>${escapeHtml(data.clientLocation)}</td></tr>
          <tr><td>Products</td><td><div class="products-list">${productsHtml}</div></td></tr>
          ${notesRow}
          <tr><td>Submitted by</td><td>${escapeHtml(data.submittedBy)}</td></tr>
          <tr><td>Date/Time</td><td>${timestamp}</td></tr>
        </table>
      </div>
      <div class="footer">
        Request ID: <b>${escapeHtml(data.id)}</b> | Diamond Shine Automated System
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
          <tr><td>Employee</td><td><strong>${escapeHtml(data.employeeName)}</strong></td></tr>
          <tr><td>Location</td><td>${escapeHtml(data.clientLocation)}</td></tr>
          <tr><td>Cleanliness</td><td>${data.cleanliness}</td></tr>
          <tr><td>Punctuality</td><td>${data.punctuality}</td></tr>
          <tr><td>Equipment</td><td>${data.equipment}</td></tr>
          <tr><td>Client Relations</td><td>${data.clientRelations}</td></tr>
          <tr><td>Overall</td><td><b>${Number(data.overall.toFixed(2))}</b> (${escapeHtml(data.category)})</td></tr>
          <tr><td>Comments</td><td>${escapeHtml(data.comments ?? '')}</td></tr>
          <tr><td>Submitted by</td><td>${escapeHtml(data.submittedBy)}</td></tr>
          <tr><td>Date/Time</td><td>${timestamp}</td></tr>
        </table>
      </div>
      <div class="footer">
        Feedback ID: <b>${escapeHtml(data.id)}</b> | Diamond Shine Automated System
      </div>
    </div>
  </body>
  </html>`
}

async function getRecipients(
  key: 'supply_alerts' | 'feedback_alerts',
  fallback: string,
  organizationId: string
): Promise<string[]> {
  try {
    const record = await prisma.notificationSetting.findUnique({
      where: {
        organizationId_key: { organizationId, key },
      },
    })
    const value = record?.recipients?.trim() || fallback
    return value
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean)
  } catch {
    return fallback.split(',').map((email) => email.trim()).filter(Boolean)
  }
}

export async function sendSuppliesNotification(
  data: SupplyEmailData,
  organizationId = LEGACY_ORGANIZATION_ID
): Promise<{ ok: boolean }> {
  try {
    const transport = getTransport()
    const recipients = await getRecipients('supply_alerts', ADMIN_EMAIL, organizationId)
    await transport.sendMail({
      from: SMTP_FROM,
      to: recipients,
      subject: `${priorityEmoji(data.priority)} SUPPLIES REQUEST - ${sanitizeHeader(data.employeeName)} (ID: ${sanitizeHeader(data.id)})`,
      html: buildSuppliesEmailHtml(data),
    })
    return { ok: true }
  } catch (error) {
    console.error('[EMAIL] failed supplies notification', error)
    return { ok: false }
  }
}

export async function sendFeedbackNotification(
  data: FeedbackEmailData,
  organizationId = LEGACY_ORGANIZATION_ID
): Promise<{ ok: boolean }> {
  try {
    const transport = getTransport()
    const recipients = await getRecipients('feedback_alerts', FEEDBACK_EMAIL, organizationId)
    await transport.sendMail({
      from: SMTP_FROM,
      to: recipients,
      subject: `📋 FEEDBACK - ${sanitizeHeader(data.employeeName)} (ID: ${sanitizeHeader(data.id)})`,
      html: buildFeedbackEmailHtml(data),
    })
    return { ok: true }
  } catch (error) {
    console.error('[EMAIL] failed feedback notification', error)
    return { ok: false }
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
  body: `<!doctype html><html lang="en"><body style="margin:0;background:#f5f7fb;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#172033"><div style="max-width:600px;margin:auto;background:#fff;border:1px solid #e5e7f0;border-radius:18px;overflow:hidden;box-shadow:0 12px 35px rgba(41,48,86,.10)"><div style="padding:28px 32px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff"><div style="font-size:20px;font-weight:800">💎 Diamond Shine</div><div style="margin-top:6px;opacity:.9">Operations Suite</div></div><div style="padding:32px"><p style="margin:0 0 8px;color:#667085">Welcome to the team</p><h1 style="margin:0 0 18px;font-size:28px">You are invited, {{name}}</h1><p style="font-size:16px;line-height:1.6">Your Diamond Shine workspace is ready. Set your password to securely finish your account setup.</p><p style="margin:28px 0"><a href="{{inviteUrl}}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#6652d8;color:#fff;text-decoration:none;font-weight:700">Create your password</a></p><div style="padding:14px 16px;border-radius:10px;background:#f6f7fb;color:#667085;font-size:13px;line-height:1.5">This secure link expires in 24 hours and can be used only once.</div><p style="color:#667085;font-size:13px;line-height:1.5">If you were not expecting this invitation, you can safely ignore this email.</p></div><div style="padding:18px 32px;background:#fafbfc;border-top:1px solid #edf0f5;color:#98a2b3;font-size:12px">Diamond Shine · Secure account invitation</div></div></body></html>`,
}

function renderTemplate(template: { subject: string; body: string }, data: Record<string, string>) {
  const subject = Object.entries(data).reduce(
    (value, [key, replacement]) => value.replaceAll(`{{${key}}}`, sanitizeHeader(replacement)),
    template.subject
  )
  const body = Object.entries(data).reduce(
    (value, [key, replacement]) => value.replaceAll(`{{${key}}}`, escapeHtml(replacement)),
    template.body
  )
  return { subject, body }
}

export async function sendQualityNotification(
  data: QualityEmailData,
  organizationId = LEGACY_ORGANIZATION_ID
): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = getTransport()
    const recipients = await getRecipients('feedback_alerts', FEEDBACK_EMAIL, organizationId)
    const identifier = data.actionId ?? data.inspectionId ?? 'quality-update'
    const rows = [
      ['Client', data.clientName],
      ['Site', data.siteName],
      ...(data.score === undefined ? [] : [['Score', `${data.score}/100`]]),
      ...(data.grade ? [['Grade', data.grade]] : []),
      ...(data.correctiveActions === undefined ? [] : [['Corrective actions', `${data.correctiveActions}`]]),
      ...(data.title ? [['Action', data.title]] : []),
      ...(data.severity ? [['Severity', data.severity]] : []),
      ...(data.status ? [['Status', data.status]] : []),
      ...(data.assignedTo ? [['Assigned to', data.assignedTo]] : []),
    ].map(([label, value]) => `<tr><td style="padding:8px 12px;font-weight:700">${escapeHtml(label)}</td><td style="padding:8px 12px">${escapeHtml(value)}</td></tr>`).join('')
    await transport.sendMail({
      from: SMTP_FROM,
      to: recipients,
      subject: `QUALITY - ${sanitizeHeader(data.clientName)} / ${sanitizeHeader(data.siteName)}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><h1>Diamond Shine quality update</h1><table style="width:100%;border-collapse:collapse">${rows}</table><p>Reference: ${escapeHtml(identifier)}</p></div>`,
    })
    return { ok: true }
  } catch (error) {
    console.error('[EMAIL] failed quality notification', error)
    return { ok: false, error: error instanceof Error ? error.message : 'SMTP error' }
  }
}

async function getTemplate(key: string) {
  try {
    const template = await prisma.emailTemplate.findUnique({
      where: {
        organizationId_key: { organizationId: LEGACY_ORGANIZATION_ID, key },
      },
    })
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

export async function sendPasswordReset(
  data: PasswordResetEmailData
): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = getTransport()
    const template = (await getTemplate('password_reset')) ?? {
      subject: 'Reset your Diamond Shine password',
      body: '<p>Hello {{name}},</p><p><a href="{{resetUrl}}">Reset your password</a>. This secure link expires in 24 hours and can only be used once.</p><p>If you did not request this, you can ignore this email.</p>',
    }
    const rendered = renderTemplate(template, {
      name: data.name,
      email: data.to,
      resetUrl: data.resetUrl,
    })
    await transport.sendMail({ from: SMTP_FROM, to: data.to, subject: rendered.subject, html: rendered.body })
    return { ok: true }
  } catch (error) {
    console.error('[EMAIL] failed password reset email', error)
    return { ok: false, error: error instanceof Error ? error.message : 'SMTP error' }
  }
}

export async function sendProfileChangeNotification(data: ProfileChangeEmailData): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = getTransport()
    const items = data.changes.map((change) => `<li>${escapeHtml(change)}</li>`).join('')
    const timestamp = formatDublinDate(data.createdAt)
    await transport.sendMail({
      from: SMTP_FROM,
      to: data.to,
      subject: `Diamond Shine · ${sanitizeHeader(data.employeeName)} updated their profile`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:640px;margin:auto;background:#f6f7fb;padding:24px"><div style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:24px;border-radius:14px 14px 0 0"><h1 style="margin:0">💎 Diamond Shine</h1><p style="margin:6px 0 0">Operational profile update</p></div><div style="background:#fff;padding:24px;border-radius:0 0 14px 14px"><h2>${escapeHtml(data.employeeName)} updated their profile</h2><p>${escapeHtml(data.summary)}</p><ul>${items}</ul><p style="color:#667085;font-size:13px">${timestamp}</p><p style="color:#667085;font-size:13px">Review future staffing and routing where relevant. Published visits were not changed automatically.</p></div></div>`,
    })
    return { ok: true }
  } catch (error) {
    console.error('[EMAIL] failed profile change notification', error)
    return { ok: false, error: error instanceof Error ? error.message : 'SMTP error' }
  }
}
