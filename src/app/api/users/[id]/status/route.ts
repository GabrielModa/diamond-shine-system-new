import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'

const bodySchema = z.object({ status: z.enum(['pending', 'active', 'inactive']) })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireCapability(request, 'memberships.manage')
  if ('response' in auth) return auth.response
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  const membership = await prisma.membership.findFirst({
    where: { userId: id, organizationId: auth.user.organizationId, status: { not: 'removed' } },
    include: { user: true },
  })
  if (!membership) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (membership.user.email === auth.user.email && parsed.data.status !== 'active') {
    return NextResponse.json({ ok: false, error: 'You cannot deactivate your own account.' }, { status: 409 })
  }
  if (membership.role === 'organization_admin' && membership.status === 'active' && parsed.data.status !== 'active') {
    const activeAdmins = await prisma.membership.count({ where: { organizationId: auth.user.organizationId, role: 'organization_admin', status: 'active' } })
    if (activeAdmins <= 1) return NextResponse.json({ ok: false, error: 'At least one active organization administrator is required.' }, { status: 409 })
  }
  const membershipStatus = parsed.data.status === 'pending' ? 'invited' : parsed.data.status === 'active' ? 'active' : 'suspended'
  const updated = await prisma.membership.update({ where: { id: membership.id }, data: { status: membershipStatus } })
  if (parsed.data.status === 'active' && membership.user.status !== 'active') {
    await prisma.user.update({ where: { id: membership.user.id }, data: { status: 'active' } })
  }
  await logAudit(auth.user.email, 'update_user_status', 'user', membership.user.id, {
    email: membership.user.email,
    fromStatus: membership.status,
    status: updated.status,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { id: membership.user.id, status: parsed.data.status } })
}
