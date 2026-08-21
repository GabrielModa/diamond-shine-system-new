import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { sendUserInvite } from '../../../lib/email'
import { issueAuthToken } from '../../../lib/auth-tokens'
import { getApplicationUrl } from '../../../lib/runtime-config'

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'supervisor', 'employee', 'viewer']).default('employee'),
})

export async function GET(request: NextRequest) {
  console.log('[API /api/users GET]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, name: true, role: true, status: true, createdAt: true, updatedAt: true },
  })
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
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ ok: false, error: 'User already exists' }, { status: 409 })
  }

  const created = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name,
      role: parsed.data.role,
      password: null,
      status: 'pending',
    },
  })

  await logAudit(auth.user.email, 'invite_user', 'user', created.id, { email: created.email, role: created.role })

  const baseUrl = getApplicationUrl()
  const { token, expiresAt } = await issueAuthToken(created.id, 'invite')
  const inviteUrl = `${baseUrl.replace(/\/$/, '')}/set-password?token=${encodeURIComponent(token)}`
  const inviteResult = await sendUserInvite({
    to: created.email,
    name: created.name ?? created.email,
    inviteUrl,
  })

  await logAudit(auth.user.email, 'invite_email', 'user', created.id, {
    email: created.email,
    sent: inviteResult.ok,
  })

  return NextResponse.json(
    { ok: true, data: { id: created.id, emailSent: inviteResult.ok, inviteExpiresAt: expiresAt } },
    { status: 201 }
  )
}
