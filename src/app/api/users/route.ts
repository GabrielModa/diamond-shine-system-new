import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { sendUserInvite } from '../../../lib/email'
import { issueAuthToken } from '../../../lib/auth-tokens'
import { getApplicationUrl } from '../../../lib/runtime-config'
import { legacyRoleToMembershipRole, membershipRoleToLegacyUserRole } from '../../../lib/tenancy'

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'supervisor', 'employee', 'viewer']).default('employee'),
})

export async function GET(request: NextRequest) {
  console.log('[API /api/users GET]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const memberships = await prisma.membership.findMany({
    where: { organizationId: auth.user.organizationId, status: { not: 'removed' } },
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: { id: true, email: true, name: true, status: true, createdAt: true, updatedAt: true },
      },
    },
  })
  const users = memberships.map((membership) => ({
    ...membership.user,
    role: membershipRoleToLegacyUserRole(membership.role),
    status: membership.status === 'invited'
      ? 'pending'
      : membership.status === 'active' && membership.user.status === 'active'
        ? 'active'
        : 'inactive',
  }))
  return NextResponse.json({ ok: true, data: users })
}

export async function POST(request: NextRequest) {
  console.log('[API /api/users POST]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const parsed = inviteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const email = parsed.data.email.trim().toLowerCase()
  const existing = await prisma.user.findUnique({
    where: { email },
    include: {
      memberships: {
        where: { organizationId: auth.user.organizationId, status: { not: 'removed' } },
        take: 1,
      },
    },
  })
  if (existing?.memberships.length) {
    return NextResponse.json({ ok: false, error: 'User already exists' }, { status: 409 })
  }

  const created = existing ?? await prisma.user.create({
    data: {
      email,
      name: parsed.data.name,
      role: parsed.data.role,
      password: null,
      status: 'pending',
    },
  })
  await prisma.membership.create({
    data: {
      organizationId: auth.user.organizationId,
      userId: created.id,
      role: legacyRoleToMembershipRole(parsed.data.role),
      status: existing?.status === 'active' ? 'active' : 'invited',
    },
  })

  await logAudit(
    auth.user.email,
    'invite_user',
    'user',
    created.id,
    { email: created.email, role: parsed.data.role },
    auth.user.organizationId
  )

  const baseUrl = getApplicationUrl()
  const authToken = existing?.status === 'active'
    ? null
    : await issueAuthToken(created.id, 'invite', auth.user.organizationId)
  const inviteUrl = authToken
    ? `${baseUrl.replace(/\/$/, '')}/set-password?token=${encodeURIComponent(authToken.token)}`
    : `${baseUrl.replace(/\/$/, '')}/login`
  const inviteResult = await sendUserInvite({ to: created.email, name: created.name ?? created.email, inviteUrl })

  await logAudit(auth.user.email, 'invite_email', 'user', created.id, {
    email: created.email,
    sent: inviteResult.ok,
  }, auth.user.organizationId)

  return NextResponse.json(
    {
      ok: true,
      data: {
        id: created.id,
        emailSent: inviteResult.ok,
        inviteExpiresAt: authToken?.expiresAt ?? null,
      },
    },
    { status: 201 }
  )
}
