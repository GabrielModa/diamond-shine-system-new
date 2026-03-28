import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireAuth } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'

const bodySchema = z.object({
  status: z.enum(['pending', 'active', 'inactive']),
})

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  console.log('[API /api/users/:id/status PATCH]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { id: params.id } })
  if (!user) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })

  const updated = await prisma.user.update({
    where: { id: params.id },
    data: { status: parsed.data.status },
  })

  await logAudit(auth.user.email, 'update_user_status', 'user', updated.id, {
    email: updated.email,
    status: updated.status,
  })

  return NextResponse.json({ ok: true, data: { id: updated.id, status: updated.status } })
}
