import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const members = await prisma.membership.findMany({
    where: {
      organizationId: auth.user.organizationId,
      status: 'active',
      role: { in: ['employee', 'field_supervisor'] },
      user: { status: 'active' },
    },
    orderBy: { user: { name: 'asc' } },
    select: { role: true, user: { select: { id: true, name: true, email: true } } },
  })
  return NextResponse.json({ ok: true, data: members.map((member) => ({ ...member.user, role: member.role })) })
}
