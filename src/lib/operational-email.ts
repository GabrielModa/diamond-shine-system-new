import nodemailer from 'nodemailer'
import { SMTP_FROM } from './constants'
import { prisma } from './prisma'
import { getSmtpConfig } from './runtime-config'

export type OperationalEmailTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

export type OperationalEmailData = {
  userIds?: string[]
  recipientEmails?: string[]
  subject: string
  eyebrow?: string
  title: string
  message: string
  details?: Array<{ label: string; value: string }>
  tone?: OperationalEmailTone
  footer?: string
}

const TONES: Record<OperationalEmailTone, { accent: string; soft: string; label: string }> = {
  info: { accent: '#2563EB', soft: '#EFF6FF', label: 'Schedule update' },
  success: { accent: '#1F7A5A', soft: '#ECFDF3', label: 'Confirmed' },
  warning: { accent: '#D97706', soft: '#FFF7ED', label: 'Attention' },
  danger: { accent: '#B42318', soft: '#FEF3F2', label: 'Important' },
  neutral: { accent: '#667085', soft: '#F2F4F7', label: 'Update' },
}

function transport() {
  if (process.env.EMAIL_TRANSPORT === 'json') return nodemailer.createTransport({ jsonTransport: true })
  return nodemailer.createTransport(getSmtpConfig())
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character] ?? character))
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function uniqueEmails(values: string[]) {
  return [...new Map(values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => [value.toLowerCase(), value] as const)).values()]
}

export function buildOperationalEmailHtml(data: OperationalEmailData) {
  const tone = TONES[data.tone ?? 'info']
  const detailRows = (data.details ?? [])
    .filter((item) => item.label.trim() && item.value.trim())
    .map((item) => `<tr><td style="padding:11px 0;color:#667085;font-size:13px;vertical-align:top;width:38%;border-bottom:1px solid #EAECF0">${escapeHtml(item.label)}</td><td style="padding:11px 0 11px 16px;color:#101828;font-size:14px;font-weight:650;vertical-align:top;border-bottom:1px solid #EAECF0">${escapeHtml(item.value)}</td></tr>`)
    .join('')

  return `<!doctype html>
<html lang="en">
<body style="margin:0;background:#F5F7FB;padding:28px 14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#101828">
  <div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E7EC;border-radius:20px;overflow:hidden;box-shadow:0 14px 38px rgba(16,24,40,.10)">
    <div style="padding:28px 30px;background:#172B4D;background:linear-gradient(135deg,#172B4D 0%,#344B73 55%,#1F7A5A 100%);color:#FFFFFF">
      <div style="font-size:21px;font-weight:850;letter-spacing:-.2px">💎 Diamond Shine</div>
      <div style="margin-top:6px;font-size:13px;opacity:.88">Operations · Field service</div>
    </div>
    <div style="padding:30px">
      <div style="display:inline-block;background:${tone.soft};color:${tone.accent};border:1px solid ${tone.accent}22;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800;letter-spacing:.2px">${escapeHtml(data.eyebrow ?? tone.label)}</div>
      <h1 style="margin:16px 0 10px;font-size:26px;line-height:1.2;letter-spacing:-.45px;color:#101828">${escapeHtml(data.title)}</h1>
      <p style="margin:0;color:#475467;font-size:15px;line-height:1.65">${escapeHtml(data.message)}</p>
      ${detailRows ? `<div style="margin-top:24px;background:#FCFCFD;border:1px solid #EAECF0;border-radius:14px;padding:4px 18px"><table role="presentation" style="width:100%;border-collapse:collapse">${detailRows}</table></div>` : ''}
      <div style="margin-top:24px;padding:14px 16px;border-left:4px solid ${tone.accent};background:${tone.soft};border-radius:10px;color:#344054;font-size:13px;line-height:1.55">Keep the Diamond Shine app and Schedule up to date before the next visit. If this update does not look right, contact Operations.</div>
    </div>
    <div style="padding:18px 30px;background:#FAFBFC;border-top:1px solid #EAECF0;color:#98A2B3;font-size:12px;line-height:1.5">${escapeHtml(data.footer ?? 'Diamond Shine · Operational notification')}</div>
  </div>
</body>
</html>`
}

async function resolveRecipients(data: OperationalEmailData, organizationId: string) {
  const userIds = [...new Set(data.userIds ?? [])]
  const memberships = userIds.length ? await prisma.membership.findMany({
    where: {
      organizationId,
      userId: { in: userIds },
      status: { not: 'removed' },
    },
    select: { user: { select: { email: true } } },
  }) : []
  return uniqueEmails([
    ...memberships.map((membership) => membership.user.email),
    ...(data.recipientEmails ?? []),
  ])
}

export async function sendOperationalEmail(
  data: OperationalEmailData,
  organizationId: string,
): Promise<{ ok: boolean; delivered?: number; error?: string }> {
  try {
    const recipients = await resolveRecipients(data, organizationId)
    if (!recipients.length) return { ok: true, delivered: 0 }

    const mailer = transport()
    const html = buildOperationalEmailHtml(data)
    for (const recipient of recipients) {
      // Send separately so employee/manager addresses are never exposed to each other.
      await mailer.sendMail({
        from: SMTP_FROM,
        to: recipient,
        subject: sanitizeHeader(data.subject),
        html,
      })
    }
    return { ok: true, delivered: recipients.length }
  } catch (error) {
    console.error('[EMAIL] failed operational notification', error)
    return { ok: false, error: error instanceof Error ? error.message : 'SMTP error' }
  }
}
