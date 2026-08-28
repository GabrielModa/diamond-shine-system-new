import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { issueAuthToken } from '../../../../../lib/auth-tokens'
import { getApplicationUrl } from '../../../../../lib/runtime-config'
import { sendUserInvite } from '../../../../../lib/email'
import { logAudit } from '../../../../../lib/audit'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireCapability(request, 'memberships.manage')
  if ('response' in auth) return auth.response
  const membership = await prisma.membership.findFirst({
    where: { userId: id, organizationId: auth.user.organizationId, status: 'invited' },
    include: { user: true },
  })
  if (!membership) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  const { token, expiresAt } = await issueAuthToken(membership.user.id, 'invite', auth.user.organizationId)
  const baseUrl = getApplicationUrl()
  const inviteUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${encodeURIComponent(token)}`
  const sent = await sendUserInvite({ to: membership.user.email, name: membership.user.name ?? membership.user.email, inviteUrl })
  await logAudit(auth.user.email, 'resend_user_invite', 'user', membership.user.id, { email: membership.user.email, sent: sent.ok }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: {
    emailSent: sent.ok,
    inviteExpiresAt: expiresAt,
    manualInviteUrl: sent.ok ? null : inviteUrl,
    deliveryError: sent.ok ? null : sent.error ?? 'Email delivery failed',
  } })
}
