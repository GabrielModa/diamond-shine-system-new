import type { Prisma } from '@prisma/client'
import { recurrenceSchema } from './schemas'

const RECURRING_ACK = 'recurring_schedule'

export function isRecurringAssignmentRule(value: unknown) {
  const parsed = recurrenceSchema.safeParse(value ?? { frequency: 'once' })
  return parsed.success && parsed.data.frequency !== 'once'
}

export async function acceptedRecurringJobIds(
  db: Prisma.TransactionClient,
  input: { organizationId: string; userId: string; jobIds: string[] },
) {
  const jobIds = [...new Set(input.jobIds)]
  if (!jobIds.length) return new Set<string>()
  const rows = await db.operationalNoticeRecipient.findMany({
    where: {
      organizationId: input.organizationId,
      userId: input.userId,
      acknowledgedAt: { not: null },
      acknowledgement: RECURRING_ACK,
      notice: {
        organizationId: input.organizationId,
        visit: { jobId: { in: jobIds } },
      },
    },
    select: { notice: { select: { visit: { select: { jobId: true } } } } },
  })
  return new Set(rows.flatMap((row) => row.notice.visit?.jobId ? [row.notice.visit.jobId] : []))
}

export async function markRecurringCommitmentAccepted(
  db: Prisma.TransactionClient,
  input: {
    organizationId: string
    userId: string
    jobId: string
    visitId: string
    siteId: string
    createdById: string
    label: string
  },
) {
  const now = new Date()
  const existing = await db.operationalNoticeRecipient.findFirst({
    where: {
      organizationId: input.organizationId,
      userId: input.userId,
      notice: {
        organizationId: input.organizationId,
        type: 'schedule_change',
        visit: { jobId: input.jobId },
      },
    },
    orderBy: { deliveredAt: 'asc' },
    select: { id: true },
  })

  if (existing) {
    await db.operationalNoticeRecipient.update({
      where: { id: existing.id },
      data: { seenAt: now, acknowledgedAt: now, acknowledgement: RECURRING_ACK },
    })
    return
  }

  await db.operationalNotice.create({
    data: {
      organizationId: input.organizationId,
      siteId: input.siteId,
      visitId: input.visitId,
      type: 'schedule_change',
      priority: 'normal',
      title: 'Recurring cleaning schedule accepted',
      body: `${input.label} was accepted as an ongoing recurring assignment. A material schedule change will require a new response.`,
      requiresAcknowledgement: true,
      createdById: input.createdById,
      recipients: {
        create: [{
          organizationId: input.organizationId,
          userId: input.userId,
          seenAt: now,
          acknowledgedAt: now,
          acknowledgement: RECURRING_ACK,
        }],
      },
    },
  })
}
