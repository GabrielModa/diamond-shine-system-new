import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireAuth } from '../../../../../lib/auth'

const schema = z.object({ status: z.enum(['Pending', 'Email Sent', 'Completed']) })

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  console.log('[API /api/supplies/:id/status PATCH]')
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

  if (row.status === 'Completed' && parsed.data.status !== 'Completed') {
    return NextResponse.json({ ok: false, error: 'Conflict' }, { status: 409 })
  }

  const nextStatus = parsed.data.status === 'Email Sent' ? 'EmailSent' : parsed.data.status

  const updated = await prisma.supplyRequest.update({
    where: { id: row.id },
    data: {
      status: nextStatus,
      emailSentAt: nextStatus === 'EmailSent' ? new Date() : row.emailSentAt,
      completedAt: nextStatus === 'Completed' ? new Date() : row.completedAt,
    },
  })

  return NextResponse.json({ ok: true, data: { id: updated.id, status: parsed.data.status } })
}
