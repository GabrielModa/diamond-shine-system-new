import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { hasCapability } from '../../../../../lib/permissions'
import { dbStatusToLabel, labelToDbStatus, type DbSupplyStatus } from '../../../../../lib/mappers'
import { logAudit } from '../../../../../lib/audit'
import { canTransitionSupplyStatus } from '../../../../../lib/business-logic'

const bodySchema = z.object({
  status: z.enum(['Requested', 'Triaged', 'Approved', 'Ordered', 'In transit', 'Delivered', 'Rejected', 'Cancelled']),
  note: z.string().trim().max(500).optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireCapability(request, 'supplies.request')
  if ('response' in auth) return auth.response
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })

  const row = await prisma.supplyRequest.findFirst({ where: { id, organizationId: auth.user.organizationId } })
  if (!row) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  const currentStatus = dbStatusToLabel(row.status as DbSupplyStatus)
  const manager = hasCapability({ role: auth.user.membershipRole, capability: 'supplies.manage', grants: auth.user.capabilityGrants })

  if (!manager) {
    if (row.submittedBy !== auth.user.email) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    if (parsed.data.status !== 'Cancelled' || currentStatus !== 'Requested') {
      return NextResponse.json({ ok: false, error: 'Only a newly requested item can be cancelled by its requester.' }, { status: 409 })
    }
  }

  if (!canTransitionSupplyStatus(currentStatus, parsed.data.status)) {
    return NextResponse.json({ ok: false, error: `Cannot move a ${currentStatus} request to ${parsed.data.status}.` }, { status: 409 })
  }
  const nextStatus = labelToDbStatus(parsed.data.status)
  const data: { status: DbSupplyStatus; completedAt?: Date | null } = { status: nextStatus }
  if (nextStatus === 'Delivered') data.completedAt = new Date()
  if (nextStatus !== 'Delivered' && row.completedAt) data.completedAt = null

  await prisma.$transaction([
    prisma.supplyRequest.updateMany({ where: { id, organizationId: auth.user.organizationId }, data }),
    prisma.supplyStatusEvent.create({
      data: {
        requestId: id,
        fromStatus: row.status,
        toStatus: nextStatus,
        actorEmail: auth.user.email,
        note: parsed.data.note || (nextStatus === 'Cancelled' ? 'Cancelled by requester or materials operations' : null),
      },
    }),
  ])
  await logAudit(auth.user.email, 'update_supply_status', 'supply', id, {
    fromStatus: currentStatus,
    status: parsed.data.status,
    note: parsed.data.note,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { id, status: parsed.data.status } })
}
