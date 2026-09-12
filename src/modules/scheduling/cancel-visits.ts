import type { Prisma } from '@prisma/client'

export const CANCELLABLE_VISIT_STATUSES = ['scheduled', 'dispatched', 'acknowledged'] as const

// Call inside the transaction that owns the lifecycle change. A concurrent
// execution start must abort the whole operation, never cancel work silently.
export async function cancelVisits(db: Prisma.TransactionClient, input: {
  organizationId: string; ids: string[]; reason: string; now: Date; servicePauseId?: string
}) {
  if (!input.ids.length) return
  const changed = await db.visit.updateMany({
    where: { organizationId: input.organizationId, id: { in: input.ids }, status: { in: [...CANCELLABLE_VISIT_STATUSES] } },
    data: { status: 'cancelled', cancelledAt: input.now, cancellationReason: input.reason,
      ...(input.servicePauseId ? { servicePauseId: input.servicePauseId } : {}), version: { increment: 1 } },
  })
  if (changed.count !== input.ids.length) throw new Error('Affected visits changed. Refresh the preview and try again.')
}