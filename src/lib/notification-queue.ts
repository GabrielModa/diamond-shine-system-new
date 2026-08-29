import type { Prisma } from '@prisma/client'
import {
  sendClientNotification,
  sendFeedbackNotification,
  sendQualityNotification,
  sendSuppliesNotification,
  sendProfileChangeNotification,
  type ClientEmailData,
  type FeedbackEmailData,
  type QualityEmailData,
  type SupplyEmailData,
  type ProfileChangeEmailData,
} from './email'
import { prisma } from './prisma'
import { sendOperationalPush } from './push-notifications'

export type NotificationKind =
  | 'supply_alert'
  | 'feedback_alert'
  | 'client_supply'
  | 'quality_inspection_failed'
  | 'corrective_action_updated'
  | 'operational_notice_push'
  | 'profile_change_alert'

type EnqueueInput = {
  organizationId: string
  kind: NotificationKind
  payload: Prisma.InputJsonValue
  createdBy: string
  entityType?: string
  entityId?: string
}

export async function enqueueNotification(input: EnqueueInput) {
  const queuedAt = new Date()
  return prisma.notificationJob.create({ data: { ...input, nextAttemptAt: queuedAt } })
}

async function deliver(kind: string, payload: Prisma.JsonValue, organizationId: string) {
  if (kind === 'supply_alert') return sendSuppliesNotification(payload as unknown as SupplyEmailData, organizationId)
  if (kind === 'feedback_alert') return sendFeedbackNotification(payload as unknown as FeedbackEmailData, organizationId)
  if (kind === 'client_supply') return sendClientNotification(payload as unknown as ClientEmailData)
  if (kind === 'quality_inspection_failed' || kind === 'corrective_action_updated') {
    return sendQualityNotification(payload as unknown as QualityEmailData, organizationId)
  }
  if (kind === 'operational_notice_push') {
    return sendOperationalPush(payload as unknown as Parameters<typeof sendOperationalPush>[0], organizationId)
  }
  if (kind === 'profile_change_alert') return sendProfileChangeNotification(payload as unknown as ProfileChangeEmailData)
  return { ok: false, error: `Unsupported notification kind: ${kind}` }
}

function retryAt(attempts: number) {
  const delayMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1))
  return new Date(Date.now() + delayMinutes * 60_000)
}

export async function processNotificationJob(id: string, organizationId?: string) {
  const now = new Date()
  const claimed = await prisma.notificationJob.updateMany({
    where: {
      id,
      ...(organizationId ? { organizationId } : {}),
      status: { in: ['queued', 'failed'] },
      nextAttemptAt: { lte: now },
      attempts: { lt: 5 },
    },
    data: { status: 'processing', attempts: { increment: 1 }, lastAttemptAt: now, lastError: null },
  })
  if (!claimed.count) return null

  const job = await prisma.notificationJob.findUniqueOrThrow({ where: { id } })
  const result = await deliver(job.kind, job.payload, job.organizationId)
  if (result.ok) {
    const sentAt = new Date()
    await prisma.$transaction([
      prisma.notificationJob.update({ where: { id }, data: { status: 'sent', sentAt } }),
      ...(job.kind === 'client_supply' && job.entityType === 'supply' && job.entityId
        ? [prisma.supplyRequest.updateMany({
            where: { id: job.entityId, organizationId: job.organizationId },
            data: { emailSentAt: sentAt },
          })]
        : []),
    ])
    return { id, status: 'sent' as const }
  }

  const exhausted = job.attempts >= job.maxAttempts
  await prisma.notificationJob.update({
    where: { id },
    data: {
      status: exhausted ? 'exhausted' : 'failed',
      lastError: ('error' in result ? result.error : undefined) ?? 'Delivery failed',
      nextAttemptAt: retryAt(job.attempts),
    },
  })
  return { id, status: exhausted ? 'exhausted' as const : 'failed' as const }
}

export async function processDueNotifications(organizationId: string, limit = 20) {
  const jobs = await prisma.notificationJob.findMany({
    where: { organizationId, status: { in: ['queued', 'failed'] }, nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: Math.min(50, Math.max(1, limit)),
    select: { id: true },
  })
  return Promise.all(jobs.map(({ id }) => processNotificationJob(id, organizationId)))
}

export async function processGlobalDueNotifications(limit = 100) {
  const jobs = await prisma.notificationJob.findMany({
    where: { status: { in: ['queued', 'failed'] }, nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: 'asc' },
    take: Math.min(250, Math.max(1, limit)),
    select: { id: true },
  })
  return Promise.all(jobs.map(({ id }) => processNotificationJob(id)))
}
