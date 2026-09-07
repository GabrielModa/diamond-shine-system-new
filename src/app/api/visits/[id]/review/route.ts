import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { prisma } from '../../../../../lib/prisma'
import { visitReviewSchema } from '../../../../../modules/execution/schemas'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'visits.review')
  if ('response' in auth) return auth.response
  const parsed = visitReviewSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid review', details: parsed.error.flatten() }, { status: 400 })
  const { id } = await params
  const visit = await prisma.visit.findFirst({ where: { id, organizationId: auth.user.organizationId }, select: { id: true, status: true, completedAt: true, version: true } })
  if (!visit) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (visit.status !== 'completed') return NextResponse.json({ ok: false, error: 'Only a completed visit can be reviewed.', code: 'VISIT_NOT_READY_FOR_REVIEW' }, { status: 409 })

  const requiresRework = parsed.data.decision !== 'approved'
  const review = await prisma.$transaction(async (tx) => {
    const reviewedAt = new Date()
    const claimed = await tx.visit.updateMany({
      where: {
        id: visit.id,
        organizationId: auth.user.organizationId,
        status: 'completed',
        version: visit.version,
      },
      data: {
        status: requiresRework ? 'in_progress' : 'completed',
        reopenedAt: requiresRework ? reviewedAt : undefined,
        reopenReason: requiresRework ? parsed.data.note : undefined,
        version: { increment: 1 },
      },
    })
    if (claimed.count !== 1) return null
    return tx.visitReview.create({
      data: { organizationId: auth.user.organizationId, visitId: visit.id, decision: parsed.data.decision, note: parsed.data.note, reviewedBy: auth.user.id },
      include: { reviewer: { select: { id: true, name: true, email: true } } },
    })
  })
  if (!review) {
    return NextResponse.json({ ok: false, error: 'This visit was already reviewed or changed. Refresh and try again.', code: 'VISIT_REVIEW_CONFLICT' }, { status: 409 })
  }
  await logAudit(auth.user.email, 'review_visit', 'visit', visit.id, { reviewId: review.id, decision: review.decision, rework: requiresRework, originalCompletedAt: visit.completedAt }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: review, rework: requiresRework })
}
