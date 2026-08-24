import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, ['admin', 'supervisor'])
  if ('response' in auth) return auth.response

  const employees = await prisma.user.findMany({
    where: {
      status: 'active',
      memberships: {
        some: {
          organizationId: auth.user.organizationId,
          role: 'employee',
          status: 'active',
        },
      },
    },
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
    select: { id: true, name: true, email: true },
  })

  return NextResponse.json({ ok: true, data: employees })
}
