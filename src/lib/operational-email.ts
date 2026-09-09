import nodemailer from 'nodemailer'
import { SMTP_FROM } from './constants'
import { prisma } from './prisma'
import { getApplicationUrl, getSmtpConfig } from './runtime-config'

export type OperationalEmailTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

export type OperationalEmailAction = {
  label: string
  path: string
}

export type OperationalEmailData = {
  userIds?: string[]
  recipientEmails?: string[]
  subject: string
  eyebrow?: string
  title: string
  message: string
  preheader?: string
  details?: Array<{ label: string; value: string }>
  action?: OperationalEmailAction
  tone?: OperationalEmailTone
  footer?: string
}

const TONES: Record<OperationalEmailTone, { accent: string; soft: string; border: string; label: string }> = {
  info: { accent: '#2563EB', soft: '#EFF6FF', border: '#BFDBFE', label: 'Schedule update' },
  success: { accent: '#1F7A5A', soft: '#ECFDF3', border: '#A7F3D0', label: 'Confirmed' },
  warning: { accent: '#D97706', soft: '#FFF7ED', border: '#FED7AA', label: 'Attention' },
  danger: { accent: '#B42318', soft: '#FEF3F2', border: '#FECDCA', label: 'Important' },
  neutral: { accent: '#475467', soft: '#F2F4F7', border: '#D0D5DD', label: 'Update' },
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

function resolveAction(action?: OperationalEmailAction) {
  const label = action?.label.trim()
  const path = action?.path.trim()
  if (!label || !path || !path.startsWith('/') || path.startsWith('//')) return null

  try {
    const origin = getApplicationUrl()
    const url = new URL(path, `${origin}/`)
    if (url.origin !== origin) return null
    return { label, url: url.toString() }
  } catch {
    return null
  }
}

function filteredDetails(data: OperationalEmailData) {
  return (data.details ?? []).filter((item) => item.label.trim() && item.value.trim())
}

export function buildOperationalEmailHtml(data: OperationalEmailData) {
  const tone = TONES[data.tone ?? 'info']
  const details = filteredDetails(data)
  const action = resolveAction(data.action)
  const applicationUrl = getApplicationUrl()
  const logoUrl = new URL('/icon.svg', `${applicationUrl}/`).toString()
  const preheader = data.preheader?.trim() || data.message
  const detailRows = details
    .map((item, index) => {
      const border = index === details.length - 1 ? '0' : '1px solid #EAECF0'
      return `<tr><td style="padding:12px 0;color:#667085;font-size:13px;line-height:1.45;vertical-align:top;width:36%;border-bottom:${border}">${escapeHtml(item.label)}</td><td style="padding:12px 0 12px 18px;color:#101828;font-size:14px;line-height:1.5;font-weight:650;vertical-align:top;border-bottom:${border};white-space:pre-line">${escapeHtml(item.value)}</td></tr>`
    })
    .join('')

  const actionHtml = action ? `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:26px">
        <tr><td>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#0F7A55" style="border-radius:10px">
            <a href="${escapeHtml(action.url)}" style="display:inline-block;padding:13px 20px;color:#FFFFFF;text-decoration:none;font-size:14px;line-height:20px;font-weight:800;border-radius:10px">${escapeHtml(action.label)}</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding-top:12px;color:#98A2B3;font-size:11px;line-height:1.55">If the button does not open, copy this address into your browser:<br><a href="${escapeHtml(action.url)}" style="color:#475467;text-decoration:underline;word-break:break-all">${escapeHtml(action.url)}</a></td></tr>
      </table>` : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>${escapeHtml(data.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F3F6F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#101828;-webkit-text-size-adjust:100%">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(preheader)}&#847; &zwnj;&nbsp;&#847; &zwnj;&nbsp;&#847;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#F3F6F9" style="width:100%;background:#F3F6F9">
    <tr><td align="center" style="padding:32px 12px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#FFFFFF;border:1px solid #DDE3EA;border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(16,42,67,.10)">
        <tr><td style="height:4px;line-height:4px;font-size:0;background:${tone.accent}">&nbsp;</td></tr>
        <tr><td bgcolor="#102A43" style="padding:24px 28px;background:#102A43">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td width="56" valign="middle" style="width:56px;padding-right:14px"><img src="${escapeHtml(logoUrl)}" width="48" height="48" alt="" style="display:block;width:48px;height:48px;border:0;border-radius:12px"></td>
            <td valign="middle"><div style="color:#FFFFFF;font-size:20px;line-height:1.15;font-weight:850;letter-spacing:-.2px">Diamond Shine</div><div style="margin-top:5px;color:#C7D7E8;font-size:12px;line-height:1.4;font-weight:650;letter-spacing:.2px">Operations Suite · Field service</div></td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:30px 28px 28px">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${tone.soft}" style="background:${tone.soft};border:1px solid ${tone.border};border-radius:999px;padding:6px 10px;color:${tone.accent};font-size:11px;line-height:1.2;font-weight:850;letter-spacing:.45px;text-transform:uppercase">${escapeHtml(data.eyebrow ?? tone.label)}</td></tr></table>
          <h1 style="margin:17px 0 10px;color:#102A43;font-size:27px;line-height:1.22;font-weight:850;letter-spacing:-.45px">${escapeHtml(data.title)}</h1>
          <p style="margin:0;color:#475467;font-size:15px;line-height:1.65">${escapeHtml(data.message)}</p>
          ${detailRows ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:24px;background:#FCFCFD;border:1px solid #EAECF0;border-radius:13px"><tr><td style="padding:4px 18px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse">${detailRows}</table></td></tr></table>` : ''}
          ${actionHtml}
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:26px"><tr><td bgcolor="${tone.soft}" style="padding:13px 15px;background:${tone.soft};border-left:4px solid ${tone.accent};border-radius:9px;color:#344054;font-size:12px;line-height:1.55">If anything here looks incorrect, check Diamond Shine before taking action or contact Operations. Never send passwords or security codes by email.</td></tr></table>
        </td></tr>
        <tr><td bgcolor="#FAFBFC" style="padding:18px 28px;background:#FAFBFC;border-top:1px solid #EAECF0;color:#7C8B9A;font-size:11px;line-height:1.55">
          <strong style="color:#475467">${escapeHtml(data.footer ?? 'Diamond Shine · Operational notification')}</strong><br>
          This message contains work information for the intended recipient. Please do not forward it outside Diamond Shine.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export function buildOperationalEmailText(data: OperationalEmailData) {
  const tone = TONES[data.tone ?? 'info']
  const details = filteredDetails(data)
  const action = resolveAction(data.action)
  return [
    'DIAMOND SHINE',
    `Operations Suite · ${data.eyebrow ?? tone.label}`,
    '',
    data.title,
    data.message,
    ...(details.length ? ['', 'DETAILS', ...details.map((item) => `${item.label}: ${item.value}`)] : []),
    ...(action ? ['', `${action.label}: ${action.url}`] : []),
    '',
    data.footer ?? 'Diamond Shine · Operational notification',
    'If anything here looks incorrect, contact Operations. Never send passwords or security codes by email.',
  ].join('\n')
}

async function operationalRecipientOverride(organizationId: string) {
  try {
    const setting = await prisma.notificationSetting.findUnique({
      where: {
        organizationId_key: {
          organizationId,
          key: 'operational_email_override',
        },
      },
      select: { recipients: true },
    })
    return uniqueEmails(setting?.recipients?.split(',') ?? [])
  } catch (error) {
    console.error('[EMAIL] failed to resolve operational recipient override', error)
    return []
  }
}

async function resolveRecipients(data: OperationalEmailData, organizationId: string) {
  const override = await operationalRecipientOverride(organizationId)
  if (override.length) return override

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
    const text = buildOperationalEmailText(data)
    for (const recipient of recipients) {
      // Send separately so employee/manager addresses are never exposed to each other.
      await mailer.sendMail({
        from: SMTP_FROM,
        to: recipient,
        subject: sanitizeHeader(data.subject),
        html,
        text,
      })
    }
    return { ok: true, delivered: recipients.length }
  } catch (error) {
    console.error('[EMAIL] failed operational notification', error)
    return { ok: false, error: error instanceof Error ? error.message : 'SMTP error' }
  }
}
