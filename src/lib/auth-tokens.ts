import { createHash, randomBytes } from 'crypto'
import type { AuthTokenType } from '@prisma/client'
import { prisma } from './prisma'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export function hashAuthToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function issueAuthToken(userId: string, type: AuthTokenType) {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashAuthToken(token)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)

  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId, type, usedAt: null } }),
    prisma.authToken.create({ data: { userId, type, tokenHash, expiresAt } }),
  ])

  return { token, expiresAt }
}
