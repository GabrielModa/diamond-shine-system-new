import { queueAuditNotification } from './audit-notifications'
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
  let auditLogId: string | undefined
  try {
    const audit = await prisma.auditLog.create({
      data: {
        actorEmail,
        organizationId,
        action,
        targetType,
        targetId,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
      select: { id: true },
    })
    auditLogId = audit.id
  } catch (error) {
    console.error('[AUDIT] failed to log', error)
  }

  // Notifications are deliberately best-effort from the request path: the
  // operational mutation is already committed, so an SMTP/queue problem must
  // never make the employee repeat the action. Delivery itself uses the normal
  // retryable NotificationJob worker.
  try {
    await queueAuditNotification({
      auditLogId,
      actorEmail,
      action,
      targetType,
      targetId,
      metadata,
      organizationId,
    })
  } catch (error) {
    console.error('[AUDIT NOTIFY] failed to queue', { action, targetType, targetId }, error)
  }
}
