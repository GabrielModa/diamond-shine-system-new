import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'
import { requireAuth } from '../../../../lib/auth'
import { createSessionToken, sessionCookie } from '../../../../lib/session'
import { membershipRoleToLegacyUserRole } from '../../../../lib/tenancy'

const ALL_LEGACY_ROLES = ['admin', 'supervisor', 'employee', 'viewer'] as const
const bodySchema = z.object({ organizationId: z.string().min(1) })

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, ALL_LEGACY_ROLES)
  if ('response' in auth) return auth.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: auth.user.id,
      organizationId: parsed.data.organizationId,
      status: 'active',
      organization: { status: 'active' },
    },
  })
  if (!membership) {
    return NextResponse.json({ ok: false, error: 'Organization access denied' }, { status: 403 })
  }

  const role = membershipRoleToLegacyUserRole(membership.role)
  const response = NextResponse.json({
    ok: true,
    data: { organizationId: membership.organizationId, role },
  })
  response.cookies.set(
    sessionCookie.name,
    await createSessionToken(auth.user.email, role, membership.organizationId),
    {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: sessionCookie.maxAge,
      secure: process.env.NODE_ENV === 'production',
    }
  )
  return response
}
