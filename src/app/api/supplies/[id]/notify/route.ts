import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireAuth } from '../../../../../lib/auth'
import { sendClientNotification } from '../../../../../lib/email'

const schema = z.object({
  clientEmail: z.string().email(),
  subject: z.string().min(1),
  htmlBody: z.string().min(1),
})

export async function POST(request: NextRequest, context: { params: { id: string } }) {
  console.log('[API /api/supplies/:id/notify POST]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const row = await prisma.supplyRequest.findUnique({ where: { id: context.params.id } })
  if (!row) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  if (row.status === 'Completed') {
    return NextResponse.json({ ok: false, error: 'Conflict' }, { status: 409 })
  }

  void sendClientNotification({
    to: parsed.data.clientEmail,
    subject: parsed.data.subject,
    htmlBody: parsed.data.htmlBody,
  })

  await prisma.supplyRequest.update({
    where: { id: row.id },
    data: { status: 'EmailSent', emailSentAt: row.emailSentAt ?? new Date() },
  })

  return NextResponse.json({ ok: true, data: { id: row.id } })
}
