import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'supervisor', 'employee', 'viewer']).default('employee'),
})

export async function GET(request: NextRequest) {
  console.log('[API /api/users GET]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } })
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

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } })
  if (existing) {
    return NextResponse.json({ ok: false, error: 'User already exists' }, { status: 409 })
  }

  const tempPassword = 'password123'
  const hash = await bcrypt.hash(tempPassword, 12)

  const created = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      role: parsed.data.role,
      password: hash,
      status: 'pending',
    },
  })

  await logAudit(auth.user.email, 'invite_user', 'user', created.id, { email: created.email, role: created.role })

  return NextResponse.json({ ok: true, data: { id: created.id, tempPassword } }, { status: 201 })
}
