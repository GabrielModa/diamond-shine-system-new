import { prisma } from './prisma'
import { lockTransactionKey } from './postgres-lock'

type RateLimitPolicy = {
  limit: number
  windowSeconds: number
}

function clientAddress(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || headers.get('x-real-ip') || 'unknown'
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function rateLimitKey(scope: string, headers: Headers, identity: string): Promise<string> {
  return sha256(`${scope}:${clientAddress(headers)}:${identity.trim().toLowerCase()}`)
}

/**
 * Consume one attempt atomically.
 *
 * Login/reset bursts for the same key used to perform a read and increment in
 * separate statements without any serialization. Concurrent requests could all
 * observe the same counter and temporarily exceed the configured limit. The
 * transaction-scoped advisory lock serializes only that hashed key.
 */
export async function consumeRateLimit(key: string, policy: RateLimitPolicy) {
  return prisma.$transaction(async (tx) => {
    await lockTransactionKey(tx, `auth-rate-limit:${key}`)

    const now = new Date()
    const existing = await tx.authRateLimit.findUnique({ where: { key } })

    if (existing && existing.resetAt > now && existing.attempts >= policy.limit) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((existing.resetAt.getTime() - now.getTime()) / 1000)),
      }
    }

    const resetAt = new Date(now.getTime() + policy.windowSeconds * 1000)
    if (!existing) {
      await tx.authRateLimit.create({ data: { key, attempts: 1, resetAt } })
    } else if (existing.resetAt <= now) {
      await tx.authRateLimit.update({ where: { key }, data: { attempts: 1, resetAt } })
    } else {
      await tx.authRateLimit.update({ where: { key }, data: { attempts: { increment: 1 } } })
    }

    return { allowed: true, retryAfter: 0 }
  })
}

export async function clearRateLimit(key: string): Promise<void> {
  await prisma.authRateLimit.deleteMany({ where: { key } })
}
