import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { enqueueNotification } from '../../../../../lib/notification-queue'
import { correctiveActionUpdateSchema } from '../../../../../modules/quality/schemas'

const transitions: Record<string, string[]> = {
  open: ['accepted', 'in_progress', 'resolved', 'waived'],
  accepted: ['in_progress', 'resolved', 'waived'],
  in_progress: ['resolved', 'waived'],
  resolved: ['verified', 'in_progress'],
  verified: [],
  waived: [],
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'quality.inspect')
  if ('response' in auth) return auth.response
  const parsed = correctiveActionUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }
  const { id } = await context.params
  const organizationId = auth.user.organizationId
  const current = await prisma.correctiveAction.findFirst({ where: { id, organizationId } })
  if (!current) return NextResponse.json({ ok: false, error: 'Corrective action not found' }, { status: 404 })
  if (current.version !== parsed.data.version) {
    return NextResponse.json({ ok: false, error: 'This action changed. Refresh and try again.' }, { status: 409 })
  }
  if (!transitions[current.status]?.includes(parsed.data.status)) {
    return NextResponse.json({ ok: false, error: `Cannot move ${current.status} to ${parsed.data.status}` }, { status: 409 })
  }
  if (parsed.data.assignedToId) {
    const member = await prisma.membership.findFirst({
      where: { organizationId, userId: parsed.data.assignedToId, status: 'active' },
      select: { id: true },
    })
    if (!member) return NextResponse.json({ ok: false, error: 'Assignee is not active in this organization' }, { status: 400 })
  }
  const now = new Date()
  const updated = await prisma.$transaction(async (tx) => {
    const action = await tx.correctiveAction.update({
      where: { id },
      data: {
        status: parsed.data.status,
        assignedToId: parsed.data.assignedToId === undefined ? current.assignedToId : parsed.data.assignedToId,
        resolutionNote: parsed.data.resolutionNote,
        acceptedAt: parsed.data.status === 'accepted' && !current.acceptedAt ? now : current.acceptedAt,
        resolvedAt: parsed.data.status === 'resolved' ? now : current.resolvedAt,
        resolvedById: parsed.data.status === 'resolved' ? auth.user.id : current.resolvedById,
        verifiedAt: parsed.data.status === 'verified' ? now : current.verifiedAt,
        version: { increment: 1 },
      },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        site: { select: { name: true, client: { select: { displayName: true } } } },
      },
    })
    if (parsed.data.status === 'verified' || parsed.data.status === 'waived') {
      const remaining = await tx.correctiveAction.count({
        where: { inspectionId: current.inspectionId, status: { notIn: ['verified', 'waived'] } },
      })
      if (remaining === 0) {
        await tx.qualityInspection.update({
          where: { id: current.inspectionId },
          data: { status: 'closed', closedAt: now },
        })
      }
    }
    return action
  })

  await enqueueNotification({
    organizationId,
    kind: 'corrective_action_updated',
    createdBy: auth.user.email,
    entityType: 'corrective_action',
    entityId: updated.id,
    payload: {
      actionId: updated.id,
      status: updated.status,
      severity: updated.severity,
      title: updated.title,
      siteName: updated.site.name,
      clientName: updated.site.client.displayName,
      assignedTo: updated.assignedTo?.email,
    },
  })
  await logAudit(auth.user.email, 'update_corrective_action', 'corrective_action', updated.id, {
    fromStatus: current.status,
    toStatus: updated.status,
    assignedToId: updated.assignedToId,
  }, organizationId)

  return NextResponse.json({ ok: true, data: updated })
}
