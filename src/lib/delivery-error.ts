// SMTP responses can echo credentials, AUTH payloads or connection URLs. Only
// emit known diagnostic categories and numeric SMTP status, never raw text.
const messages: Record<string, string> = {
  EAUTH: 'Invalid login or SMTP authentication rejected',
  ECONNECTION: 'SMTP connection failed',
  ECONNREFUSED: 'SMTP connection refused',
  ECONNRESET: 'SMTP connection reset',
  ETIMEDOUT: 'SMTP connection timed out',
  EDNS: 'SMTP hostname lookup failed',
  ENOTFOUND: 'SMTP hostname not found',
  ESOCKET: 'SMTP socket or TLS connection failed',
  ETLS: 'SMTP TLS negotiation failed',
  EENVELOPE: 'SMTP sender or recipient rejected',
  EMESSAGE: 'SMTP message rejected',
  ESTREAM: 'SMTP message stream failed',
  EPROTOCOL: 'Unexpected SMTP protocol response',
  CERT_HAS_EXPIRED: 'SMTP TLS certificate has expired',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'SMTP TLS certificate is self-signed',
  ERR_TLS_CERT_ALTNAME_INVALID: 'SMTP TLS certificate hostname mismatch',
}

const providerReasons: Array<[RegExp, string]> = [
  [/smtpclientauthentication.*disabled|smtp auth.*disabled/i, 'SMTP AUTH is disabled for this account or tenant'],
  [/application.specific password|app password.*required/i, 'An application-specific password is required'],
  [/quota|rate.limit|too many messages/i, 'SMTP quota or rate limit exceeded'],
  [/mailbox.*unavailable|user unknown|recipient.*not found/i, 'Recipient mailbox unavailable'],
]

export function sanitizeDeliveryError(error: unknown): string {
  const record = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown; responseCode?: unknown } : {}
  const message = typeof error === 'string' ? error : typeof record.message === 'string' ? record.message : ''
  if (message === 'SMTP configuration is missing or invalid' || message === 'Maximum delivery attempts reached.') return message
  // Accept only known codes; arbitrary error properties may themselves be secrets.
  const code = typeof record.code === 'string' && Object.prototype.hasOwnProperty.call(messages, record.code)
    ? record.code
    : Object.keys(messages).find((key) => message.startsWith(`${key}:`))
  const responseCode = record.responseCode ?? Number(message.match(/\(SMTP ([45]\d{2})\)$/)?.[1])
  const status = typeof responseCode === 'number' && Number.isInteger(responseCode)
    && responseCode >= 400 && responseCode <= 599 ? ` (SMTP ${responseCode})` : ''
  const reason = providerReasons.find(([pattern]) => pattern.test(message))?.[1]
  if (code) return `${code}: ${reason ?? messages[code]}${status}`
  if (/invalid login|authentication|credentials/i.test(message)) return `EAUTH: ${messages.EAUTH}${status}`
  if (/connection refused/i.test(message)) return `ECONNREFUSED: ${messages.ECONNREFUSED}${status}`
  if (/timed? ?out/i.test(message)) return `ETIMEDOUT: ${messages.ETIMEDOUT}${status}`
  if (/SMTP_HOST|SMTP_PORT|SMTP_USER|SMTP_PASS/.test(message)) return 'SMTP configuration is missing or invalid'
  return `Delivery failed: unclassified transport or delivery error${status}`
}
