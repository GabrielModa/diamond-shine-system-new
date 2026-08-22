import { prisma } from './prisma'
import { LEGACY_ORGANIZATION_ID } from './tenancy'

export async function logAudit(
  actorEmail: string,
  action: string,
  targetType: string,
  targetId?: string,
  metadata?: Record<string, unknown>,
  organizationId = LEGACY_ORGANIZATION_ID
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorEmail,
        organizationId,
        action,
        targetType,
        targetId,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    })
  } catch (error) {
    console.error('[AUDIT] failed to log', error)
  }
}
