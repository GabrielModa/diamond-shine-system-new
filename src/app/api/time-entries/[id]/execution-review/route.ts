import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { prisma } from '../../../../../lib/prisma'

const bodySchema = z.object({
  decision: z.enum(['cleared', 'blocked']),
  note: z.string().trim().max(1000).optional().nullable(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'time.team.review')
  if ('response' in auth) return auth.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })

  const { id } = await params
  const current = await prisma.timeEntry.findFirst({
    where: { id, organizationId: auth.user.organizationId },
  })
  if (!current) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (current.status === 'running') {
    return NextResponse.json({ ok: false, error: 'Stop the timer before reviewing execution.' }, { status: 409 })
  }
  if (!['needs_review', 'completed'].includes(current.status)) {
    return NextResponse.json({
      ok: false,
      error: 'This entry already has a payroll decision. Change payroll in Timesheets instead.',
    }, { status: 409 })
  }

  const note = parsed.data.note?.trim() || ''
  if (parsed.data.decision === 'blocked' && !note) {
    return NextResponse.json({
      ok: false,
      error: 'Add a manager note explaining what must be corrected before clearing this review.',
    }, { status: 400 })
  }

  const marker = parsed.data.decision === 'cleared'
    ? 'EXECUTION_REVIEW_CLEARED' + (note ? ': ' + note : '')
    : 'EXECUTION_REVIEW_BLOCKED: ' + note
  const reviewReason = [current.reviewReason, marker].filter(Boolean).join(' | ')
  const status = parsed.data.decision === 'cleared' ? 'completed' : 'needs_review'

  const updated = await prisma.timeEntry.update({
    where: { id: current.id },
    data: {
      status,
      reviewReason,
      payableSeconds: null,
      approvedBy: null,
      approvedAt: null,
    },
  })

  await logAudit(auth.user.email, 'review_time_execution', 'time_entry', current.id, {
    decision: parsed.data.decision,
    note: note || null,
    fromStatus: current.status,
    status,
    payrollReady: false,
    userId: current.userId,
  }, auth.user.organizationId)

  return NextResponse.json({
    ok: true,
    data: {
      id: updated.id,
      status: updated.status,
      payrollReady: false,
    },
  })
}
