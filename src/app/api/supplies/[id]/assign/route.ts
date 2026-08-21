import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireAuth } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'

const bodySchema = z.object({ assigneeEmail: z.string().email().nullable() })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })

  const supply = await prisma.supplyRequest.findUnique({ where: { id } })
  if (!supply) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (supply.status === 'Completed' || supply.status === 'Cancelled') {
    return NextResponse.json({ ok: false, error: 'Closed requests cannot be reassigned.' }, { status: 409 })
  }

  const assigneeEmail = parsed.data.assigneeEmail?.trim().toLowerCase() ?? null
  if (assigneeEmail) {
    const assignee = await prisma.user.findFirst({
      where: { email: assigneeEmail, status: 'active', role: { in: ['admin', 'supervisor'] } },
    })
    if (!assignee) {
      return NextResponse.json({ ok: false, error: 'Assignee must be an active administrator or supervisor.' }, { status: 400 })
    }
  }

  const updated = await prisma.supplyRequest.update({ where: { id }, data: { assignedTo: assigneeEmail } })
  await logAudit(auth.user.email, 'assign_supply', 'supply', id, { assignedTo: assigneeEmail })
  return NextResponse.json({ ok: true, data: { id: updated.id, assignedTo: updated.assignedTo } })
}
