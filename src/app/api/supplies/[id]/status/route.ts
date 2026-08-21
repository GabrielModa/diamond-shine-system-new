import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireAuth } from '../../../../../lib/auth'
import { dbStatusToLabel, labelToDbStatus, type DbSupplyStatus } from '../../../../../lib/mappers'
import { logAudit } from '../../../../../lib/audit'
import { canTransitionSupplyStatus } from '../../../../../lib/business-logic'

const bodySchema = z.object({
  status: z.enum(['Requested', 'Triaged', 'Approved', 'Ordered', 'In transit', 'Delivered', 'Rejected', 'Cancelled']),
  note: z.string().trim().max(500).optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  console.log('[API /api/supplies/:id/status PATCH]')
  const auth = await requireAuth(request, ['admin', 'supervisor', 'employee'])
  if ('response' in auth) return auth.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const row = await prisma.supplyRequest.findUnique({ where: { id } })
  if (!row) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  const currentStatus = dbStatusToLabel(row.status as DbSupplyStatus)

  if (auth.user.role !== 'admin') {
    if (row.submittedBy !== auth.user.email) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }
    if (parsed.data.status !== 'Cancelled' || currentStatus !== 'Requested') {
      return NextResponse.json({ ok: false, error: 'Only newly requested items can be cancelled.' }, { status: 409 })
    }
  }

  const nextStatus = labelToDbStatus(parsed.data.status)
  if (!canTransitionSupplyStatus(currentStatus, parsed.data.status)) {
    return NextResponse.json({ ok: false, error: `Cannot move a ${currentStatus} request to ${parsed.data.status}.` }, { status: 409 })
  }

  const data: { status: DbSupplyStatus; completedAt?: Date } = {
    status: nextStatus,
  }

  if (nextStatus === 'Delivered') data.completedAt = new Date()

  await prisma.$transaction([
    prisma.supplyRequest.update({ where: { id }, data }),
    prisma.supplyStatusEvent.create({
      data: {
        requestId: id,
        fromStatus: row.status,
        toStatus: nextStatus,
        actorEmail: auth.user.email,
        note: parsed.data.note || (nextStatus === 'Cancelled' ? 'Cancelled by requester or administrator' : null),
      },
    }),
  ])

  await logAudit(auth.user.email, 'update_supply_status', 'supply', id, {
    status: parsed.data.status,
  })

  return NextResponse.json({ ok: true, data: { id, status: parsed.data.status } })
}
