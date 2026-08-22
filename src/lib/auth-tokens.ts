import { createHash, randomBytes } from 'crypto'
import type { AuthTokenType } from '@prisma/client'
import { prisma } from './prisma'
import bcrypt from 'bcryptjs'
import { LEGACY_ORGANIZATION_ID } from './tenancy'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export function hashAuthToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function issueAuthToken(
  userId: string,
  type: AuthTokenType,
  organizationId = LEGACY_ORGANIZATION_ID
) {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashAuthToken(token)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)

  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId, organizationId, type, usedAt: null } }),
    prisma.authToken.create({ data: { userId, organizationId, type, tokenHash, expiresAt } }),
  ])

  return { token, expiresAt }
}

export async function setPasswordWithAuthToken(rawToken: string, type: AuthTokenType, rawPassword: string) {
  const tokenHash = hashAuthToken(rawToken)
  const password = await bcrypt.hash(rawPassword, 12)
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    const token = await tx.authToken.findUnique({ where: { tokenHash } })
    if (!token || token.type !== type || token.usedAt || token.expiresAt <= now) return null

    const claimed = await tx.authToken.updateMany({
      where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    if (claimed.count !== 1) return null

    const user = await tx.user.update({
      where: { id: token.userId },
      data: { password, ...(type === 'invite' ? { status: 'active' } : {}) },
    })
    if (type === 'invite') {
      await tx.membership.updateMany({
        where: {
          userId: token.userId,
          organizationId: token.organizationId,
          status: 'invited',
        },
        data: { status: 'active' },
      })
    }
    return user
  })
}
