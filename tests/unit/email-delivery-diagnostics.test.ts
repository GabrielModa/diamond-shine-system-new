import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(), verify: vi.fn(), close: vi.fn(), setting: vi.fn(), members: vi.fn(),
  create: vi.fn(), findFirst: vi.fn(), claim: vi.fn(), job: vi.fn(), update: vi.fn(), findMany: vi.fn(),
  auth: vi.fn(), after: vi.fn(),
}))
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail: mocks.sendMail, verify: mocks.verify, close: mocks.close })) } }))
vi.mock('next/server', async (original) => ({ ...await original<typeof import('next/server')>(), after: mocks.after }))
vi.mock('../../src/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('../../src/lib/prisma', () => ({ prisma: {
  notificationSetting: { findUnique: mocks.setting }, membership: { findMany: mocks.members },
  notificationJob: { create: mocks.create, findFirst: mocks.findFirst, updateMany: mocks.claim, findUniqueOrThrow: mocks.job, update: mocks.update, findMany: mocks.findMany },
  $transaction: (values: unknown[]) => Promise.all(values),
} }))
import { sanitizeDeliveryError } from '../../src/lib/delivery-error'
import { sendSuppliesNotification, sendFeedbackNotification } from '../../src/lib/email'
import { sendOperationalEmail } from '../../src/lib/operational-email'
import { enqueueNotification, processNotificationJob } from '../../src/lib/notification-queue'
import { GET as cron } from '../../src/app/api/internal/notifications/cron/route'
import { POST as worker } from '../../src/app/api/internal/notifications/process/route'
import { POST as diagnostic } from '../../src/app/api/notifications/test/route'
const payload = { id: 's1', employeeName: 'Employee', clientLocation: 'Site', priority: 'normal' as const, products: [], submittedBy: 'employee@example.org' }
const smtpError = Object.assign(new Error('Invalid login password=secret smtp://user:password@host AUTH hidden-token'), { code: 'EAUTH', responseCode: 535 })
const secret = 'test-only-secret-with-more-than-32-characters'
const req = (path: string, token?: string) => new NextRequest(`http://localhost${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.setting.mockResolvedValue(null)
  mocks.members.mockResolvedValue([])
  mocks.sendMail.mockResolvedValue({ accepted: ['admin@example.org'], rejected: [] })
  mocks.verify.mockResolvedValue(true)
  mocks.auth.mockResolvedValue({ user: { email: 'admin@example.org', organizationId: 'org' } })
  mocks.findFirst.mockResolvedValue({ attempts: 0, maxAttempts: 3 })
  mocks.claim.mockResolvedValue({ count: 1 })
  mocks.job.mockResolvedValue({ id: 'job', organizationId: 'org', kind: 'supply_alert', payload, attempts: 1, maxAttempts: 3 })
  mocks.findMany.mockResolvedValue([{ id: 'job' }])
})
afterEach(() => vi.unstubAllEnvs())
describe('safe SMTP diagnostics and queue persistence', () => {
  it('retains diagnostic code and SMTP status without echoing secrets or arbitrary fields', () => {
    const safe = sanitizeDeliveryError(smtpError)
    expect(safe).toBe('EAUTH: Invalid login or SMTP authentication rejected (SMTP 535)')
    expect(sanitizeDeliveryError(safe)).toBe(safe)
    expect(sanitizeDeliveryError({ code: 'SECRET', message: 'smtp://user:password@host token=hidden' })).not.toMatch(/password|hidden|SECRET/)
  })
  it('returns useful sanitized failures from supplies, feedback and operational mailers', async () => {
    mocks.sendMail.mockRejectedValue(smtpError)
    const feedback = { ...payload, cleanliness: 5, punctuality: 5, equipment: 5, clientRelations: 5, overall: 5, category: 'Excellent' }
    const results = await Promise.all([sendSuppliesNotification(payload, 'org'), sendFeedbackNotification(feedback, 'org'), sendOperationalEmail({ recipientEmails: ['real@example.org'], subject: 'Test', title: 'Test', message: 'Test' }, 'org')])
    for (const result of results) expect(result).toEqual({ ok: false, error: sanitizeDeliveryError(smtpError) })
  })
  it('persists specific failure and schedules retry', async () => {
    mocks.sendMail.mockRejectedValue(smtpError)
    expect(await processNotificationJob('job')).toEqual({ id: 'job', status: 'failed' })
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'job' }, data: expect.objectContaining({ status: 'failed', lastError: sanitizeDeliveryError(smtpError), nextAttemptAt: expect.any(Date) }) })
  })
  it('marks successful delivery sent', async () => {
    expect(await processNotificationJob('job')).toEqual({ id: 'job', status: 'sent' })
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'job' }, data: { status: 'sent', sentAt: expect.any(Date) } })
  })
  it('exhausts the final failed attempt and does not deliver an unclaimed job', async () => {
    mocks.job.mockResolvedValueOnce({ id: 'job', organizationId: 'org', kind: 'supply_alert', payload, attempts: 3, maxAttempts: 3 })
    mocks.sendMail.mockRejectedValue(smtpError)
    expect(await processNotificationJob('job')).toEqual({ id: 'job', status: 'exhausted' })
    mocks.sendMail.mockClear(); mocks.claim.mockResolvedValue({ count: 0 })
    expect(await processNotificationJob('job')).toBeNull()
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })
  it('preserves operational override and real recipient fallback', async () => {
    const data = { recipientEmails: ['real@example.org'], subject: 'Test', title: 'Test', message: 'Test' }
    mocks.setting.mockResolvedValueOnce({ recipients: 'test@example.org' })
    await sendOperationalEmail(data, 'org')
    expect(mocks.sendMail).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'test@example.org' }))
    await sendOperationalEmail(data, 'org')
    expect(mocks.sendMail).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'real@example.org' }))
  })
  it('returns the durable job before post-response SMTP work begins', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    mocks.create.mockResolvedValue({ id: 'job', organizationId: 'org' })
    mocks.sendMail.mockImplementation(() => new Promise(() => {}))
    await expect(enqueueNotification({ organizationId: 'org', kind: 'supply_alert', payload, createdBy: 'employee' })).resolves.toEqual({ id: 'job', organizationId: 'org' })
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function))
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })
})
describe('cron and worker authentication', () => {
  it('rejects absent configuration, missing and invalid authorization', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await cron(req('/cron', secret))).status).toBe(401)
    vi.stubEnv('CRON_SECRET', secret)
    expect((await cron(req('/cron'))).status).toBe(401)
    expect((await cron(req('/cron', 'wrong'))).status).toBe(401)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
  it('processes due notifications with valid cron authorization', async () => {
    vi.stubEnv('CRON_SECRET', secret)
    const response = await cron(req('/cron', secret))
    expect(await response.json()).toEqual({ ok: true, data: { processed: 1, sent: 1, failed: 0 } })
  })
  it('keeps the POST worker secret independent', async () => {
    vi.stubEnv('CRON_SECRET', secret)
    vi.stubEnv('NOTIFICATION_WORKER_SECRET', `${secret}-worker`)
    expect((await worker(req('/worker', secret))).status).toBe(401)
    expect((await worker(req('/worker'))).status).toBe(401)
    expect((await worker(req('/worker', `${secret}-worker`))).status).toBe(200)
  })
})
describe('admin diagnostic', () => {
  it('rejects unauthorized users before connecting to SMTP', async () => {
    mocks.auth.mockResolvedValue({ response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })
    expect((await diagnostic(req('/test'))).status).toBe(403)
    expect(mocks.auth).toHaveBeenCalledWith(expect.anything(), ['admin'])
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it('verifies and sends only to the authenticated account', async () => {
    const response = await diagnostic(new NextRequest('http://localhost/test', { method: 'POST', body: JSON.stringify({ to: 'arbitrary@example.org' }) }))
    expect(response.status).toBe(200)
    expect(mocks.verify).toHaveBeenCalledOnce()
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@example.org' }))
    expect(mocks.close).toHaveBeenCalledOnce()
  })
  it('reports sanitized verification failure without sending', async () => {
    mocks.verify.mockRejectedValue(smtpError)
    const response = await diagnostic(req('/test'))
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ ok: false, error: sanitizeDeliveryError(smtpError) })
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })
  it('reports rejection after verification instead of claiming delivery', async () => {
    mocks.sendMail.mockResolvedValue({ accepted: [], rejected: ['admin@example.org'] })
    expect((await diagnostic(req('/test'))).status).toBe(502)
  })
})
