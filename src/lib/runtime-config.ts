export function getApplicationUrl(): string {
  const configured = process.env.NEXTAUTH_URL?.trim()
  if (!configured) {
    if (process.env.NODE_ENV === 'production') throw new Error('NEXTAUTH_URL is required in production')
    return 'http://localhost:3000'
  }

  const url = new URL(configured)
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('NEXTAUTH_URL must use HTTPS in production')
  }
  return url.origin
}

export function getSmtpConfig() {
  const host = process.env.SMTP_HOST?.trim()
  if (!host && process.env.NODE_ENV === 'production') throw new Error('SMTP_HOST is required in production')

  const port = Number(process.env.SMTP_PORT ?? '587')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT must be a valid TCP port')

  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS
  if ((user && !pass) || (!user && pass)) throw new Error('SMTP_USER and SMTP_PASS must be configured together')

  return {
    host: host || 'localhost',
    port,
    secure: process.env.SMTP_SECURE === 'true',
    auth: user ? { user, pass: pass as string } : undefined,
  }
}
