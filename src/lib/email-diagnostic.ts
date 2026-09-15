import nodemailer from 'nodemailer'
import { SMTP_FROM } from './constants'
import { getSmtpConfig } from './runtime-config'
import { sanitizeDeliveryError } from './delivery-error'

type DeliveryChecks = { smtpVerified: boolean; recipientAccepted: boolean }

export async function testEmailDelivery(recipient: string) {
  let checks: DeliveryChecks = { smtpVerified: false, recipientAccepted: false }
  try {
    // Deliberately use real SMTP, never the JSON transport used by test suites.
    const transport = nodemailer.createTransport({
      ...getSmtpConfig(), connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    })
    try {
      await transport.verify()
      checks = { ...checks, smtpVerified: true }
      const result = await transport.sendMail({
        from: SMTP_FROM, to: recipient,
        subject: 'Diamond Shine email delivery test',
        text: 'This email was requested by you from Communications delivery settings. SMTP verification succeeded. Receiving this message confirms delivery to your inbox.',
      })
      if (!result.accepted?.length || result.rejected?.length) {
        return { ok: false as const, error: 'EENVELOPE: SMTP sender or recipient rejected', checks }
      }
      checks = { ...checks, recipientAccepted: true }
      return {
        ok: true as const,
        message: 'SMTP verified and the sending server accepted the test message for delivery. Inbox placement is not confirmed automatically; check inbox and spam.',
        messageId: result.messageId,
        checks,
      }
    } finally { transport.close() }
  } catch (error) {
    return { ok: false as const, error: sanitizeDeliveryError(error), checks }
  }
}
