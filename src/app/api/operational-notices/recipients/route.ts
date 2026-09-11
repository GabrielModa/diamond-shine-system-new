import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../lib/auth'
import { prisma } from '../../../../lib/prisma'

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'communications.manage')
  if ('response' in auth) return auth.response

  const memberships = await prisma.membership.findMany({
    where: {
      organizationId: auth.user.organizationId,
      status: 'active',
      user: { status: 'active' },
    },
    orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true } },
    },
  })

  return NextResponse.json({
    ok: true,
    data: memberships.map((membership) => ({
      ...membership.user,
      role: membership.role,
    })),
  })
}
