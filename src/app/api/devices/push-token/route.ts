import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '../../../../lib/auth'
import { prisma } from '../../../../lib/prisma'

const tokenPattern = /^Expo(?:nent)?PushToken\[[^\]]{8,}\]$/
const registrationSchema = z.object({
  token: z.string().regex(tokenPattern).max(256),
  platform: z.enum(['ios', 'android']),
  deviceId: z.string().trim().min(1).max(160).optional(),
})
const removalSchema = z.object({ token: z.string().regex(tokenPattern).max(256) })

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, ['admin', 'supervisor', 'employee'])
  if ('response' in auth) return auth.response
  const parsed = registrationSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid push token' }, { status: 400 })
  const token = await prisma.devicePushToken.upsert({
    where: { token: parsed.data.token },
    update: {
      userId: auth.user.id,
      organizationId: auth.user.organizationId,
      platform: parsed.data.platform,
      deviceId: parsed.data.deviceId,
      active: true,
      lastRegisteredAt: new Date(),
    },
    create: {
      userId: auth.user.id,
      organizationId: auth.user.organizationId,
      ...parsed.data,
    },
    select: { id: true, platform: true, active: true, lastRegisteredAt: true },
  })
  return NextResponse.json({ ok: true, data: token }, { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request, ['admin', 'supervisor', 'employee'])
  if ('response' in auth) return auth.response
  const parsed = removalSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid push token' }, { status: 400 })
  await prisma.devicePushToken.updateMany({
    where: { token: parsed.data.token, userId: auth.user.id, organizationId: auth.user.organizationId },
    data: { active: false },
  })
  return NextResponse.json({ ok: true })
}
