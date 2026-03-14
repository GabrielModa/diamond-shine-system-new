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
