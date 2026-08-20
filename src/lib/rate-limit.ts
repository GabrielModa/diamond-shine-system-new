import { prisma } from './prisma'
import { Prisma } from '@prisma/client'

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

export async function consumeRateLimit(key: string, policy: RateLimitPolicy) {
  const now = new Date()
  const existing = await prisma.authRateLimit.findUnique({ where: { key } })

  if (existing && existing.resetAt > now && existing.attempts >= policy.limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((existing.resetAt.getTime() - now.getTime()) / 1000)) }
  }

  const resetAt = new Date(now.getTime() + policy.windowSeconds * 1000)
  if (!existing) {
    try {
      await prisma.authRateLimit.create({ data: { key, attempts: 1, resetAt } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return consumeRateLimit(key, policy)
      }
      throw error
    }
  } else if (existing.resetAt <= now) {
    await prisma.authRateLimit.update({ where: { key }, data: { attempts: 1, resetAt } })
  } else {
    await prisma.authRateLimit.update({ where: { key }, data: { attempts: { increment: 1 } } })
  }

  return { allowed: true, retryAfter: 0 }
}

export async function clearRateLimit(key: string): Promise<void> {
  await prisma.authRateLimit.deleteMany({ where: { key } })
}
