import bcrypt from 'bcryptjs'
import { prisma } from './prisma'
import { hashAuthToken } from './auth-tokens'

export async function getInviteSetupContext(rawToken: string) {
  const tokenHash = hashAuthToken(rawToken)
  const token = await prisma.authToken.findUnique({ where: { tokenHash } })
  if (!token || token.type !== 'invite' || token.usedAt || token.expiresAt <= new Date()) return null

  const [user, membership] = await Promise.all([
    prisma.user.findUnique({
      where: { id: token.userId },
      select: { id: true, name: true, email: true, password: true, status: true },
    }),
    prisma.membership.findFirst({
      where: {
        userId: token.userId,
        organizationId: token.organizationId,
        status: { not: 'removed' },
      },
      select: { id: true, role: true, status: true, organizationId: true },
    }),
  ])

  if (!user || !membership) return null
  return { token, user, membership }
}

export async function stageInvitePassword(rawToken: string, rawPassword: string) {
  const context = await getInviteSetupContext(rawToken)
  if (!context) return null

  if (context.user.status === 'active' || context.membership.status === 'active') {
    return { ...context, stage: 'complete' as const, needsProfileSetup: false }
  }

  const password = context.user.password ?? await bcrypt.hash(rawPassword, 12)
  const needsProfileSetup = ['employee', 'field_supervisor'].includes(context.membership.role)

  if (needsProfileSetup) {
    if (!context.user.password) {
      await prisma.user.update({
        where: { id: context.user.id },
        data: { password },
      })
    }
    return { ...context, stage: 'profile' as const, needsProfileSetup: true }
  }

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.authToken.updateMany({
      where: { id: context.token.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    if (claimed.count !== 1) throw new Error('Invitation already used or expired.')
    await tx.user.update({
      where: { id: context.user.id },
      data: { password, status: 'active' },
    })
    await tx.membership.update({
      where: { id: context.membership.id },
      data: { status: 'active' },
    })
  })
  return { ...context, stage: 'complete' as const, needsProfileSetup: false }
}
