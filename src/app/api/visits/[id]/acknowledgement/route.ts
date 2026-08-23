import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { acknowledgementSchema } from '../../../../../modules/scheduling/schemas'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const { id } = await params
  const parsed = acknowledgementSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  const assignment = await prisma.visitAssignment.findFirst({ where: { visitId: id, userId: auth.user.id, organizationId: auth.user.organizationId, status: { not: 'removed' } } })
  if (!assignment) return NextResponse.json({ ok: false, error: 'Assignment not found' }, { status: 404 })
  const now = new Date()
  const updated = await prisma.visitAssignment.update({ where: { id: assignment.id }, data: {
    status: parsed.data.status,
    seenAt: parsed.data.status === 'seen' ? now : assignment.seenAt ?? now,
    acknowledgedAt: parsed.data.status === 'acknowledged' ? now : undefined,
    declinedAt: parsed.data.status === 'declined' ? now : undefined,
    declineReason: parsed.data.status === 'declined' ? parsed.data.reason : null,
  } })
  if (parsed.data.status === 'acknowledged') await prisma.visit.updateMany({ where: { id, status: { in: ['scheduled', 'dispatched'] } }, data: { status: 'acknowledged' } })
  await logAudit(auth.user.email, 'visit_assignment_response', 'visit_assignment', updated.id, { visitId: id, status: updated.status, reason: updated.declineReason }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: updated })
}
