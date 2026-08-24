import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireAuth } from '../../../../../lib/auth'
import { enqueueNotification } from '../../../../../lib/notification-queue'
import { logAudit } from '../../../../../lib/audit'

const bodySchema = z.object({
  clientEmail: z.string().email(),
  subject: z.string().min(1),
  htmlBody: z.string().min(1),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  console.log('[API /api/supplies/:id/notify POST]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const row = await prisma.supplyRequest.findFirst({
    where: { id, organizationId: auth.user.organizationId },
  })
  if (!row) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  if (row.status === 'Delivered' || row.status === 'Rejected' || row.status === 'Cancelled') {
    return NextResponse.json({ ok: false, error: 'Conflict' }, { status: 409 })
  }

  const job = await enqueueNotification({
    organizationId: auth.user.organizationId,
    kind: 'client_supply',
    createdBy: auth.user.email,
    entityType: 'supply',
    entityId: id,
    payload: { to: parsed.data.clientEmail, subject: parsed.data.subject, htmlBody: parsed.data.htmlBody },
  })

  await logAudit(auth.user.email, 'send_supply_email', 'supply', id, {
    clientEmail: parsed.data.clientEmail,
  }, auth.user.organizationId)

  return NextResponse.json({ ok: true, data: { id, queued: true, notificationJobId: job.id } }, { status: 202 })
}
