import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { prisma } from '../../../../../lib/prisma'

const identitySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
}).strict()

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'memberships.manage')
  if ('response' in auth) return auth.response
  const { id } = await params

  const parsed = identitySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Enter a valid name and work email.', details: parsed.error.flatten() }, { status: 400 })
  }

  const membership = await prisma.membership.findFirst({
    where: { organizationId: auth.user.organizationId, userId: id },
    include: { user: { select: { id: true, name: true, email: true, status: true } } },
  })
  if (!membership) return NextResponse.json({ ok: false, error: 'Person not found in this organization.' }, { status: 404 })

  const existingEmailOwner = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true } })
  if (existingEmailOwner && existingEmailOwner.id !== id) {
    return NextResponse.json({ ok: false, error: 'That work email is already in use.' }, { status: 409 })
  }

  const before = membership.user
  const updated = await prisma.user.update({
    where: { id },
    data: { name: parsed.data.name, email: parsed.data.email },
    select: { id: true, name: true, email: true, status: true },
  })

  await logAudit(
    auth.user.email,
    'update_user_identity',
    'user',
    id,
    {
      nameChanged: (before.name ?? '') !== updated.name,
      emailChanged: before.email !== updated.email,
      previousEmail: before.email,
    },
    auth.user.organizationId,
  )

  return NextResponse.json({ ok: true, data: updated })
}
