import bcrypt from 'bcryptjs'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'
import { hashAuthToken } from '../../../../lib/auth-tokens'

const bodySchema = z.object({
  token: z.string().min(20),
  password: z
    .string()
    .min(12)
    .max(128)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/[0-9]/),
})

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Use at least 12 characters with uppercase, lowercase, and a number.' },
      { status: 400 }
    )
  }

  const tokenHash = hashAuthToken(parsed.data.token)
  const password = await bcrypt.hash(parsed.data.password, 12)
  const now = new Date()

  const result = await prisma.$transaction(async (tx) => {
    const token = await tx.authToken.findUnique({ where: { tokenHash } })
    if (!token || token.type !== 'invite' || token.usedAt || token.expiresAt <= now) return null

    const claimed = await tx.authToken.updateMany({
      where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    })
    if (claimed.count !== 1) return null

    return tx.user.update({ where: { id: token.userId }, data: { password } })
  })

  if (!result) {
    return NextResponse.json({ ok: false, error: 'This invitation is invalid or has expired.' }, { status: 400 })
  }

  return NextResponse.json({ ok: true, data: { status: result.status } })
}
