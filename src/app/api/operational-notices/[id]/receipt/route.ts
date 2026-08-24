import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../lib/prisma'
import { requireAuth } from '../../../../../lib/auth'
import { operationalNoticeReceiptSchema } from '../../../../../modules/communications/schemas'

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request, ['admin', 'supervisor', 'employee'])
  if ('response' in auth) return auth.response
  const parsed = operationalNoticeReceiptSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  const { id } = await context.params
  const receipt = await prisma.operationalNoticeRecipient.findFirst({
    where: { noticeId: id, userId: auth.user.id, organizationId: auth.user.organizationId },
    include: { notice: { select: { requiresAcknowledgement: true } } },
  })
  if (!receipt) return NextResponse.json({ ok: false, error: 'Notice not found' }, { status: 404 })
  if (parsed.data.action === 'acknowledged' && !receipt.notice.requiresAcknowledgement) {
    return NextResponse.json({ ok: false, error: 'This notice does not require acknowledgement' }, { status: 409 })
  }
  const now = new Date()
  const updated = await prisma.operationalNoticeRecipient.update({
    where: { id: receipt.id },
    data: {
      seenAt: receipt.seenAt ?? now,
      ...(parsed.data.action === 'acknowledged'
        ? { acknowledgedAt: receipt.acknowledgedAt ?? now, acknowledgement: parsed.data.acknowledgement }
        : {}),
    },
  })
  return NextResponse.json({ ok: true, data: updated })
}
