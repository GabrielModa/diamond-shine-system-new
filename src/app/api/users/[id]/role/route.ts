import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireAuth } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { legacyRoleToMembershipRole } from '../../../../../lib/tenancy'

const bodySchema = z.object({
  role: z.enum(['admin', 'supervisor', 'employee', 'viewer']),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  console.log('[API /api/users/:id/role PATCH]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: id, organizationId: auth.user.organizationId, status: { not: 'removed' } },
    include: { user: true },
  })
  if (!membership) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  const user = membership.user

  if (user.email === auth.user.email && parsed.data.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'You cannot remove your own administrator role.' }, { status: 409 })
  }

  if (membership.role === 'organization_admin' && membership.status === 'active' && parsed.data.role !== 'admin') {
    const activeAdmins = await prisma.membership.count({
      where: {
        organizationId: auth.user.organizationId,
        role: 'organization_admin',
        status: 'active',
      },
    })
    if (activeAdmins <= 1) {
      return NextResponse.json({ ok: false, error: 'At least one active administrator is required.' }, { status: 409 })
    }
  }

  await prisma.membership.update({
    where: { id: membership.id },
    data: { role: legacyRoleToMembershipRole(parsed.data.role) },
  })

  await logAudit(auth.user.email, 'update_user_role', 'user', user.id, {
    email: user.email,
    role: parsed.data.role,
  }, auth.user.organizationId)

  return NextResponse.json({ ok: true, data: { id: user.id, role: parsed.data.role } })
}
