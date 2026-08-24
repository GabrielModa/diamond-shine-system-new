import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../lib/prisma'
import { requireAuth } from '../../../../../lib/auth'
import { issueAuthToken } from '../../../../../lib/auth-tokens'
import { getApplicationUrl } from '../../../../../lib/runtime-config'
import { sendUserInvite } from '../../../../../lib/email'
import { logAudit } from '../../../../../lib/audit'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const membership = await prisma.membership.findFirst({
    where: { userId: id, organizationId: auth.user.organizationId, status: 'invited' },
    include: { user: true },
  })
  if (!membership) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  const user = membership.user
  if (membership.status !== 'invited') {
    return NextResponse.json({ ok: false, error: 'Invitations can only be resent to pending users.' }, { status: 409 })
  }

  const { token, expiresAt } = await issueAuthToken(user.id, 'invite', auth.user.organizationId)
  const baseUrl = getApplicationUrl()
  const inviteUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${encodeURIComponent(token)}`
  const sent = await sendUserInvite({ to: user.email, name: user.name ?? user.email, inviteUrl })
  await logAudit(
    auth.user.email,
    'resend_user_invite',
    'user',
    user.id,
    { email: user.email, sent: sent.ok },
    auth.user.organizationId
  )

  return NextResponse.json({ ok: true, data: { emailSent: sent.ok, inviteExpiresAt: expiresAt } })
}
