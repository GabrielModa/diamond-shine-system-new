import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { legacyRoleToMembershipRole, membershipRoleToLegacyUserRole } from '../../../../../lib/tenancy'

const bodySchema = z.object({
  role: z.enum(['admin', 'supervisor', 'employee', 'viewer']).optional(),
  membershipRole: z.enum(['organization_admin', 'field_supervisor', 'scheduler', 'employee', 'stock_controller', 'quality_inspector', 'finance', 'viewer']).optional(),
}).refine((value) => Boolean(value.role || value.membershipRole), 'Role is required')

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireCapability(request, 'memberships.manage')
  if ('response' in auth) return auth.response
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  const nextRole = parsed.data.membershipRole ?? legacyRoleToMembershipRole(parsed.data.role!)

  const membership = await prisma.membership.findFirst({
    where: { userId: id, organizationId: auth.user.organizationId, status: { not: 'removed' } },
    include: { user: true },
  })
  if (!membership) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (membership.user.email === auth.user.email && nextRole !== 'organization_admin') {
    return NextResponse.json({ ok: false, error: 'You cannot remove your own organization administrator role.' }, { status: 409 })
  }
  if (membership.role === 'organization_admin' && membership.status === 'active' && nextRole !== 'organization_admin') {
    const activeAdmins = await prisma.membership.count({
      where: { organizationId: auth.user.organizationId, role: 'organization_admin', status: 'active' },
    })
    if (activeAdmins <= 1) return NextResponse.json({ ok: false, error: 'At least one active organization administrator is required.' }, { status: 409 })
  }

  await prisma.membership.update({ where: { id: membership.id }, data: { role: nextRole } })
  await logAudit(auth.user.email, 'update_user_role', 'user', membership.user.id, {
    email: membership.user.email,
    fromRole: membership.role,
    membershipRole: nextRole,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: {
    id: membership.user.id,
    role: membershipRoleToLegacyUserRole(nextRole),
    membershipRole: nextRole,
  } })
}
