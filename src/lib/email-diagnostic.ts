import nodemailer from 'nodemailer'
import { SMTP_FROM } from './constants'
import { getSmtpConfig } from './runtime-config'
import { sanitizeDeliveryError } from './delivery-error'

export async function testEmailDelivery(recipient: string) {
  try {
    // Deliberately use real SMTP, never the JSON transport used by test suites.
    const transport = nodemailer.createTransport({
      ...getSmtpConfig(), connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    })
    try {
      await transport.verify()
      const result = await transport.sendMail({
        from: SMTP_FROM, to: recipient,
        subject: 'Diamond Shine email delivery test',
        text: 'This email was requested by you from Communications delivery settings. SMTP verification succeeded. Receiving this message confirms delivery to your inbox.',
      })
      if (!result.accepted?.length || result.rejected?.length) {
        return { ok: false, error: 'EENVELOPE: SMTP sender or recipient rejected' }
      }
      return { ok: true, message: 'SMTP verified and test email accepted by the server. Check your inbox and spam folder to confirm receipt.' }
    } finally { transport.close() }
  } catch (error) {
    return { ok: false, error: sanitizeDeliveryError(error) }
  }
}
