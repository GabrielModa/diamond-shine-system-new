import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireAuth } from '../../../../../lib/auth'
import { sendClientNotification } from '../../../../../lib/email'
import { logAudit } from '../../../../../lib/audit'

const bodySchema = z.object({
  clientEmail: z.string().email(),
  subject: z.string().min(1),
  htmlBody: z.string().min(1),
})

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  console.log('[API /api/supplies/:id/notify POST]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const row = await prisma.supplyRequest.findUnique({ where: { id: params.id } })
  if (!row) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  if (row.status === 'Completed') {
    return NextResponse.json({ ok: false, error: 'Conflict' }, { status: 409 })
  }

  const sendResult = await sendClientNotification({
    to: parsed.data.clientEmail,
    subject: parsed.data.subject,
    htmlBody: parsed.data.htmlBody,
  })

  if (sendResult.ok) {
    await prisma.supplyRequest.update({
      where: { id: params.id },
      data: { status: 'EmailSent', emailSentAt: new Date() },
    })
  }

  await logAudit(auth.user.email, 'send_supply_email', 'supply', params.id, {
    clientEmail: parsed.data.clientEmail,
  })

  return NextResponse.json({ ok: true, data: { id: params.id, sent: sendResult.ok } })
}
