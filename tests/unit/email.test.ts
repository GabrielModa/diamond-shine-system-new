import { describe, it, expect, vi } from 'vitest'

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'mock-id' }),
    })),
    createTestAccount: vi.fn().mockResolvedValue({
      user: 'test@ethereal.email',
      pass: 'testpass',
    }),
    getTestMessageUrl: vi.fn().mockReturnValue('https://ethereal.email/preview/mock'),
  },
}))

import type { SupplyEmailData, FeedbackEmailData } from '../../src/lib/email'
import {
  sendSuppliesNotification,
  sendFeedbackNotification,
  sendClientNotification,
  sendPasswordReset,
  sendUserInvite,
} from '../../src/lib/email'

async function spySendMail(rejectWith?: Error) {
  const nodemailer = await import('nodemailer')
  const sendMail = rejectWith
    ? vi.fn().mockRejectedValue(rejectWith)
    : vi.fn().mockResolvedValue({ messageId: 'mock-id' })
  vi.mocked(nodemailer.default.createTransport).mockReturnValueOnce({ sendMail } as never)
  return sendMail
}

const supplyBase: SupplyEmailData = {
  id: 'supply-abc',
  employeeName: 'Emma Employee',
  clientLocation: 'TechCorp Office - Dublin 2',
  priority: 'urgent',
  products: ['All-purpose cleaner', 'Rubber gloves'],
  items: [{ product: 'All-purpose cleaner', quantity: 3 }, { product: 'Rubber gloves', quantity: 2 }],
  notes: 'Need before 9am',
  submittedBy: 'emma@ds.ie',
}

const feedbackBase: FeedbackEmailData = {
  id: 'feedback-abc',
  employeeName: 'Emma Employee',
  clientLocation: 'TechCorp Office - Dublin 2',
  cleanliness: 5.0,
  punctuality: 4.5,
  equipment: 5.0,
  clientRelations: 4.5,
  overall: 4.75,
  category: 'Excellent',
  comments: 'Outstanding work',
  submittedBy: 'super@ds.ie',
}

describe('sendSuppliesNotification', () => {
  it('never throws even if SMTP transport fails', async () => {
    await spySendMail(new Error('SMTP connection refused'))
    await expect(sendSuppliesNotification(supplyBase)).resolves.not.toThrow()
  })

  it('sends to SUPPLY_ADMIN_EMAIL env var', async () => {
    const sendMail = await spySendMail()
    await sendSuppliesNotification(supplyBase)
    expect(sendMail.mock.calls[0]?.[0]?.to).toBeTruthy()
  })

  it('subject contains employee name', async () => {
    const sendMail = await spySendMail()
    await sendSuppliesNotification(supplyBase)
    expect(sendMail.mock.calls[0]?.[0]?.subject).toContain('Emma Employee')
  })

  it('subject uses 🔴 for urgent', async () => {
    const sendMail = await spySendMail()
    await sendSuppliesNotification({ ...supplyBase, priority: 'urgent' })
    expect(sendMail.mock.calls[0]?.[0]?.subject).toContain('🔴')
  })

  it('subject uses 🟡 for normal', async () => {
    const sendMail = await spySendMail()
    await sendSuppliesNotification({ ...supplyBase, priority: 'normal' })
    expect(sendMail.mock.calls[0]?.[0]?.subject).toContain('🟡')
  })

  it('subject uses 🟢 for low', async () => {
    const sendMail = await spySendMail()
    await sendSuppliesNotification({ ...supplyBase, priority: 'low' })
    expect(sendMail.mock.calls[0]?.[0]?.subject).toContain('🟢')
  })

  it('html body contains employee name', async () => {
    const sendMail = await spySendMail()
    await sendSuppliesNotification(supplyBase)
    const html: string = sendMail.mock.calls[0]?.[0]?.html ?? ''
    expect(html).toContain('Emma Employee')
  })

  it('html body contains client location', async () => {
    const sendMail = await spySendMail()
    await sendSuppliesNotification(supplyBase)
    const html: string = sendMail.mock.calls[0]?.[0]?.html ?? ''
    expect(html).toContain('TechCorp Office - Dublin 2')
  })

  it('escapes dynamic HTML and strips header line breaks', async () => {
    const sendMail = await spySendMail()
    await sendSuppliesNotification({
      ...supplyBase,
      employeeName: 'Emma\r\nBcc: attacker@example.com',
      notes: '<script>alert(1)</script>',
    })
    const message = sendMail.mock.calls[0]?.[0]
    expect(message?.subject).not.toMatch(/[\r\n]/)
    expect(message?.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(message?.html).not.toContain('<script>alert(1)</script>')
  })
})

describe('sendPasswordReset', () => {
  it('sends a one-time reset link to the account email', async () => {
    const sendMail = await spySendMail()
    await sendPasswordReset({
      to: 'emma@ds.ie',
      name: 'Emma Employee',
      resetUrl: 'https://diamondshine.ie/reset-password?token=secret',
    })
    expect(sendMail.mock.calls[0]?.[0]?.to).toBe('emma@ds.ie')
    expect(sendMail.mock.calls[0]?.[0]?.html).toContain('/reset-password?token=secret')
  })

  it('html body contains requested quantities', async () => {
    const sendMail = await spySendMail()
    await sendSuppliesNotification(supplyBase)
    expect(sendMail.mock.calls[0]?.[0]?.html).toContain('All-purpose cleaner × 3')
  })
})

describe('sendFeedbackNotification', () => {
  it('never throws even if SMTP transport fails', async () => {
    await spySendMail(new Error('SMTP down'))
    await expect(sendFeedbackNotification(feedbackBase)).resolves.not.toThrow()
  })

  it('subject starts with 📋', async () => {
    const sendMail = await spySendMail()
    await sendFeedbackNotification(feedbackBase)
    expect(sendMail.mock.calls[0]?.[0]?.subject).toContain('📋')
  })

  it('subject contains employee name', async () => {
    const sendMail = await spySendMail()
    await sendFeedbackNotification(feedbackBase)
    expect(sendMail.mock.calls[0]?.[0]?.subject).toContain('Emma Employee')
  })

  it('html body contains overall score', async () => {
    const sendMail = await spySendMail()
    await sendFeedbackNotification(feedbackBase)
    const html: string = sendMail.mock.calls[0]?.[0]?.html ?? ''
    expect(html).toContain('4.75')
  })

  it('escapes feedback comments before rendering email HTML', async () => {
    const sendMail = await spySendMail()
    await sendFeedbackNotification({ ...feedbackBase, comments: '<img src=x onerror=alert(1)>' })
    const html: string = sendMail.mock.calls[0]?.[0]?.html ?? ''
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
  })
})

describe('templated authentication emails', () => {
  it('escapes invite variables without removing template markup', async () => {
    const sendMail = await spySendMail()
    await sendUserInvite({
      to: 'new@ds.ie',
      name: '<img src=x onerror=alert(1)>',
      inviteUrl: 'https://diamondshine.ie/set-password?token=safe',
    })
    const html: string = sendMail.mock.calls[0]?.[0]?.html ?? ''
    expect(html).toContain('<a href="https://diamondshine.ie/set-password?token=safe">')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})

describe('sendClientNotification', () => {
  it('never throws even if SMTP transport fails', async () => {
    await spySendMail(new Error('Connection timeout'))
    await expect(
      sendClientNotification({ to: 'client@corp.ie', subject: 'Update', htmlBody: '<p>Hi</p>' })
    ).resolves.not.toThrow()
  })

  it('sends to the provided client email address', async () => {
    const sendMail = await spySendMail()
    await sendClientNotification({ to: 'client@techcorp.ie', subject: 'Test', htmlBody: '<p>Hi</p>' })
    expect(sendMail.mock.calls[0]?.[0]?.to).toBe('client@techcorp.ie')
  })

  it('uses the provided subject', async () => {
    const sendMail = await spySendMail()
    await sendClientNotification({ to: 'x@x.com', subject: 'Custom Subject', htmlBody: '<p>Hi</p>' })
    expect(sendMail.mock.calls[0]?.[0]?.subject).toBe('Custom Subject')
  })
})
