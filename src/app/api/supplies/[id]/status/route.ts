import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireAuth } from '../../../../../lib/auth'
import { labelToDbStatus } from '../../../../../lib/mappers'
import { logAudit } from '../../../../../lib/audit'

const bodySchema = z.object({
  status: z.enum(['Pending', 'Email Sent', 'Completed']),
})

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  console.log('[API /api/supplies/:id/status PATCH]')
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

  const nextStatus = labelToDbStatus(parsed.data.status)
  const validTransition =
    (row.status === 'Pending' && (nextStatus === 'EmailSent' || nextStatus === 'Completed')) ||
    (row.status === 'EmailSent' && nextStatus === 'Completed')

  if (!validTransition) {
    return NextResponse.json({ ok: false, error: 'Conflict' }, { status: 409 })
  }

  const data: { status: 'Pending' | 'EmailSent' | 'Completed'; emailSentAt?: Date; completedAt?: Date } = {
    status: nextStatus,
  }

  if (nextStatus === 'EmailSent') data.emailSentAt = new Date()
  if (nextStatus === 'Completed') data.completedAt = new Date()

  await prisma.supplyRequest.update({ where: { id: params.id }, data })

  await logAudit(auth.user.email, 'update_supply_status', 'supply', params.id, {
    status: parsed.data.status,
  })

  return NextResponse.json({ ok: true, data: { id: params.id, status: parsed.data.status } })
}
