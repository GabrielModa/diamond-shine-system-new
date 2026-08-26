import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { enqueueNotification } from '../../../../../lib/notification-queue'
import { logAudit } from '../../../../../lib/audit'

const bodySchema = z.object({ clientEmail: z.string().email(), subject: z.string().min(1), htmlBody: z.string().min(1) })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireCapability(request, 'supplies.manage')
  if ('response' in auth) return auth.response
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  const row = await prisma.supplyRequest.findFirst({ where: { id, organizationId: auth.user.organizationId } })
  if (!row) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (['Delivered', 'Rejected', 'Cancelled'].includes(row.status)) return NextResponse.json({ ok: false, error: 'Closed requests cannot send new fulfilment emails.' }, { status: 409 })
  const job = await enqueueNotification({
    organizationId: auth.user.organizationId,
    kind: 'client_supply',
    createdBy: auth.user.email,
    entityType: 'supply',
    entityId: id,
    payload: { to: parsed.data.clientEmail, subject: parsed.data.subject, htmlBody: parsed.data.htmlBody },
  })
  await logAudit(auth.user.email, 'send_supply_email', 'supply', id, { clientEmail: parsed.data.clientEmail, notificationJobId: job.id }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { id, queued: true, notificationJobId: job.id } }, { status: 202 })
}
