import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'communications.manage')
  if ('response' in auth) return auth.response

  const { id } = await context.params
  const notice = await prisma.operationalNotice.findFirst({
    where: { id, organizationId: auth.user.organizationId },
    select: { id: true, title: true, priority: true, createdById: true },
  })
  if (!notice) return NextResponse.json({ ok: false, error: 'Notice not found' }, { status: 404 })

  await prisma.$transaction([
    prisma.notificationJob.deleteMany({
      where: {
        organizationId: auth.user.organizationId,
        entityType: 'operational_notice',
        entityId: notice.id,
      },
    }),
    prisma.operationalNotice.delete({ where: { id: notice.id } }),
  ])

  await logAudit(auth.user.email, 'delete_operational_notice', 'operational_notice', notice.id, {
    title: notice.title,
    priority: notice.priority,
    createdById: notice.createdById,
  }, auth.user.organizationId)

  return NextResponse.json({ ok: true, data: { id: notice.id } })
}
