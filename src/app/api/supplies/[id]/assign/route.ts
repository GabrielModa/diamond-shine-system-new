import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'

const bodySchema = z.object({ assigneeEmail: z.string().email().nullable() })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireCapability(request, 'supplies.manage')
  if ('response' in auth) return auth.response
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })

  const supply = await prisma.supplyRequest.findFirst({ where: { id, organizationId: auth.user.organizationId } })
  if (!supply) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (['Delivered', 'Rejected', 'Cancelled'].includes(supply.status)) {
    return NextResponse.json({ ok: false, error: 'Closed requests cannot be reassigned.' }, { status: 409 })
  }

  const assigneeEmail = parsed.data.assigneeEmail?.trim().toLowerCase() ?? null
  if (assigneeEmail) {
    const assignee = await prisma.user.findFirst({
      where: {
        email: assigneeEmail,
        status: 'active',
        memberships: {
          some: {
            organizationId: auth.user.organizationId,
            status: 'active',
            role: { in: ['organization_admin', 'field_supervisor', 'stock_controller'] },
          },
        },
      },
    })
    if (!assignee) return NextResponse.json({ ok: false, error: 'Assignee must be an active materials manager, field supervisor or administrator.' }, { status: 400 })
  }

  await prisma.supplyRequest.updateMany({ where: { id, organizationId: auth.user.organizationId }, data: { assignedTo: assigneeEmail } })
  await logAudit(auth.user.email, 'assign_supply', 'supply', id, { previousAssignedTo: supply.assignedTo, assignedTo: assigneeEmail }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { id, assignedTo: assigneeEmail } })
}
