import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'supplies.manage')
  if ('response' in auth) return auth.response

  const memberships = await prisma.membership.findMany({
    where: {
      organizationId: auth.user.organizationId,
      status: 'active',
      role: { in: ['organization_admin', 'field_supervisor', 'stock_controller'] },
      user: { status: 'active' },
    },
    select: {
      role: true,
      user: { select: { email: true, name: true } },
    },
    orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
  })

  return NextResponse.json({
    ok: true,
    data: memberships.map((membership) => ({
      email: membership.user.email,
      name: membership.user.name,
      role: membership.role,
      status: 'active',
    })),
  })
}
