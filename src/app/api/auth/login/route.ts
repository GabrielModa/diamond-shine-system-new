import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '../../../../lib/prisma'

function deriveRole(email: string) {
  if (email.startsWith('admin@')) return 'admin'
  if (email.startsWith('super@')) return 'supervisor'
  if (email.startsWith('employee@')) return 'employee'
  return 'viewer'
}

export async function POST(request: NextRequest) {
  console.log('[API /api/auth/login POST]')
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null
  if (!body?.email || !body?.password) {
    return NextResponse.json({ ok: false, error: 'Invalid credentials' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { email: body.email } })
  if (!user?.password) {
    return NextResponse.json({ ok: false, error: 'Incorrect email or password' }, { status: 401 })
  }
  if (user.status !== 'active') {
    return NextResponse.json({ ok: false, error: 'Account pending approval' }, { status: 403 })
  }

  const valid = await bcrypt.compare(body.password, user.password)
  if (!valid) {
    return NextResponse.json({ ok: false, error: 'Incorrect email or password' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true, data: { email: user.email, role: user.role } })
  response.cookies.set('ds-auth', user.email, { httpOnly: true, sameSite: 'lax', path: '/' })
  response.cookies.set('ds-role', user.role, { httpOnly: true, sameSite: 'lax', path: '/' })
  return response
}
