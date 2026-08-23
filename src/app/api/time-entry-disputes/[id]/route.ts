import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { prisma } from '../../../../lib/prisma'
import { timeEntryDisputeResolveSchema } from '../../../../modules/execution/schemas'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'time.team.review')
  if ('response' in auth) return auth.response
  const parsed = timeEntryDisputeResolveSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'A decision and explanation are required.', details: parsed.error.flatten() }, { status: 400 })
  const { id } = await params
  const current = await prisma.timeEntryDispute.findFirst({ where: { id, organizationId: auth.user.organizationId } })
  if (!current) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (current.status !== 'open') return NextResponse.json({ ok: false, error: 'This correction request has already been resolved.' }, { status: 409 })
  const dispute = await prisma.timeEntryDispute.update({
    where: { id: current.id },
    data: { status: parsed.data.decision, resolution: parsed.data.resolution, resolvedBy: auth.user.id, resolvedAt: new Date() },
    select: { id: true, reason: true, status: true, resolution: true, resolvedAt: true, createdAt: true },
  })
  await logAudit(auth.user.email, 'resolve_time_entry_dispute', 'time_entry_dispute', dispute.id, { decision: dispute.status, timeEntryId: current.timeEntryId }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: dispute })
}
