import type { Prisma } from '@prisma/client'

/**
 * Serialize a critical section on one PostgreSQL transaction-scoped key.
 *
 * The lock is released automatically when the surrounding transaction ends,
 * including rollback paths, so callers do not need cleanup logic.
 */
export async function lockTransactionKey(tx: Prisma.TransactionClient, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
}
