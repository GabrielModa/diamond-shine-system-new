import type { Prisma } from '@prisma/client'
import { lockTransactionKey } from '../../lib/postgres-lock'

/**
 * Serialize timer starts for one worker inside the current transaction.
 *
 * The schema intentionally allows historical time entries, so a partial unique
 * index for status = running would require a data-cleanup migration. A
 * transaction-scoped PostgreSQL advisory lock gives the same start-time
 * invariant without changing historical rows or production data.
 */
export async function lockUserTimerStart(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
) {
  await lockTransactionKey(tx, `time-entry:${organizationId}:${userId}`)
}
