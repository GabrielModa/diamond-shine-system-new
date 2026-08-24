import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { prisma } from '../../../../../lib/prisma'
import { timeEntryReviewSchema } from '../../../../../modules/execution/schemas'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'time.team.review')
  if ('response' in auth) return auth.response
  const parsed = timeEntryReviewSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  const { id } = await params
  const current = await prisma.timeEntry.findFirst({ where: { id, organizationId: auth.user.organizationId } })
  if (!current) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (current.status === 'running') return NextResponse.json({ ok: false, error: 'Stop the timer before reviewing it.' }, { status: 409 })
  const reason = parsed.data.note
    ? [current.reviewReason, `REVIEW: ${parsed.data.note}`].filter(Boolean).join(' | ')
    : current.reviewReason
  const updated = await prisma.timeEntry.update({
    where: { id: current.id },
    data: {
      status: parsed.data.decision,
      approvedBy: parsed.data.decision === 'approved' ? auth.user.id : null,
      approvedAt: parsed.data.decision === 'approved' ? new Date() : null,
      reviewReason: reason,
    },
  })
  await logAudit(auth.user.email, 'review_time_entry', 'time_entry', current.id, {
    decision: parsed.data.decision,
    note: parsed.data.note,
    userId: current.userId,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: updated })
}

