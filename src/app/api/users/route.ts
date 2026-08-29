import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { sendUserInvite } from '../../../lib/email'
import { issueAuthToken } from '../../../lib/auth-tokens'
import { getApplicationUrl } from '../../../lib/runtime-config'
import { legacyRoleToMembershipRole, membershipRoleToLegacyUserRole } from '../../../lib/tenancy'

const membershipRoleSchema = z.enum([
  'organization_admin', 'field_supervisor', 'scheduler', 'employee',
  'stock_controller', 'quality_inspector', 'finance', 'viewer',
])
const inviteSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(2).max(120),
  role: z.enum(['admin', 'supervisor', 'employee', 'viewer']).optional(),
  membershipRole: membershipRoleSchema.optional(),
})

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'memberships.manage')
  if ('response' in auth) return auth.response
  const memberships = await prisma.membership.findMany({
    where: { organizationId: auth.user.organizationId, status: { not: 'removed' } },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { id: true, email: true, name: true, password: true, status: true, createdAt: true, updatedAt: true } } },
  })
  const users = memberships.map((membership) => ({
    id: membership.user.id,
    email: membership.user.email,
    name: membership.user.name,
    createdAt: membership.user.createdAt,
    updatedAt: membership.user.updatedAt,
    role: membershipRoleToLegacyUserRole(membership.role),
    membershipRole: membership.role,
    membershipId: membership.id,
    hasPassword: Boolean(membership.user.password),
    setupStage: membership.status === 'invited'
      ? (membership.user.password ? 'profile_setup' : 'invited')
      : membership.status === 'active' && membership.user.status === 'active'
        ? 'active'
        : 'inactive',
    status: membership.status === 'invited'
      ? 'pending'
      : membership.status === 'active' && membership.user.status === 'active'
        ? 'active'
        : 'inactive',
  }))
  return NextResponse.json({ ok: true, data: users })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'memberships.manage')
  if ('response' in auth) return auth.response
  const parsed = inviteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })

  const email = parsed.data.email.trim().toLowerCase()
  const membershipRole = parsed.data.membershipRole ?? legacyRoleToMembershipRole(parsed.data.role ?? 'employee')
  const legacyRole = membershipRoleToLegacyUserRole(membershipRole)
  const baseUrl = getApplicationUrl()
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { memberships: { where: { organizationId: auth.user.organizationId }, take: 1 } },
  })
  const existingMembership = existing?.memberships[0] ?? null
  if (existingMembership && existingMembership.status !== 'removed') {
    return NextResponse.json({ ok: false, error: 'User already exists in this organization' }, { status: 409 })
  }

  const created = existing ?? await prisma.user.create({
    data: { email, name: parsed.data.name, role: legacyRole, password: null, status: 'pending' },
  })
  const membershipStatus = existing?.status === 'active' ? 'active' : 'invited'
  const membership = existingMembership
    ? await prisma.membership.update({
        where: { id: existingMembership.id },
        data: { role: membershipRole, status: membershipStatus },
      })
    : await prisma.membership.create({
        data: {
          organizationId: auth.user.organizationId,
          userId: created.id,
          role: membershipRole,
          status: membershipStatus,
        },
      })
  await logAudit(auth.user.email, 'invite_user', 'user', created.id, {
    email: created.email,
    membershipRole,
  }, auth.user.organizationId)

  const authToken = existing?.status === 'active' ? null : await issueAuthToken(created.id, 'invite', auth.user.organizationId)
  const inviteUrl = authToken
    ? `${baseUrl.replace(/\/$/, '')}/set-password?token=${encodeURIComponent(authToken.token)}`
    : `${baseUrl.replace(/\/$/, '')}/login`
  const inviteResult = await sendUserInvite({ to: created.email, name: created.name ?? created.email, inviteUrl })
  await logAudit(auth.user.email, 'invite_email', 'user', created.id, { email: created.email, sent: inviteResult.ok }, auth.user.organizationId)

  return NextResponse.json({ ok: true, data: {
    id: created.id,
    membershipId: membership.id,
    membershipRole,
    emailSent: inviteResult.ok,
    inviteExpiresAt: authToken?.expiresAt ?? null,
    manualInviteUrl: authToken && !inviteResult.ok ? inviteUrl : null,
    deliveryError: inviteResult.ok ? null : inviteResult.error ?? 'Email delivery failed',
  } }, { status: 201 })
}
