import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { prisma } from '../../../../lib/prisma'
import { sendPushDiagnostic } from '../../../../lib/push-notifications'

export const runtime = 'nodejs'
export const maxDuration = 60

const bodySchema = z.object({ userId: z.string().trim().min(1).max(160) })

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const registrations = await prisma.devicePushToken.findMany({
    where: {
      organizationId: auth.user.organizationId,
      active: true,
      user: { status: 'active' },
    },
    select: {
      userId: true,
      platform: true,
      lastRegisteredAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { lastRegisteredAt: 'desc' },
  })

  const targets = new Map<string, {
    id: string
    name: string | null
    email: string
    deviceCount: number
    platforms: Set<string>
    lastRegisteredAt: Date
  }>()
  for (const registration of registrations) {
    const current = targets.get(registration.userId)
    if (!current) {
      targets.set(registration.userId, {
        id: registration.user.id,
        name: registration.user.name,
        email: registration.user.email,
        deviceCount: 1,
        platforms: new Set([registration.platform]),
        lastRegisteredAt: registration.lastRegisteredAt,
      })
      continue
    }
    current.deviceCount += 1
    current.platforms.add(registration.platform)
    if (registration.lastRegisteredAt > current.lastRegisteredAt) current.lastRegisteredAt = registration.lastRegisteredAt
  }

  return NextResponse.json({
    ok: true,
    data: {
      targets: Array.from(targets.values()).map((target) => ({
        ...target,
        platforms: Array.from(target.platforms),
      })),
    },
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Choose a valid mobile user.' }, { status: 400 })

  const membership = await prisma.membership.findFirst({
    where: {
      organizationId: auth.user.organizationId,
      userId: parsed.data.userId,
      status: 'active',
      user: { status: 'active' },
    },
    select: { user: { select: { id: true, name: true, email: true } } },
  })
  if (!membership) return NextResponse.json({ ok: false, error: 'Active team member not found.' }, { status: 404 })

  const result = await sendPushDiagnostic(parsed.data.userId, auth.user.organizationId)
  await logAudit(auth.user.email, 'test_mobile_push', 'user', parsed.data.userId, {
    targetEmail: membership.user.email,
    registered: result.registered,
    accepted: result.accepted,
    failed: result.failed,
  }, auth.user.organizationId)

  const data = {
    target: membership.user,
    registered: result.registered,
    accepted: result.accepted,
    failed: result.failed,
    invalidated: result.invalidated,
    ticketIds: result.ticketIds,
    platforms: result.platforms,
    lastRegisteredAt: result.lastRegisteredAt,
  }

  if (!result.ok) {
    const status = result.reason === 'no_devices' ? 409 : 502
    return NextResponse.json({ ok: false, error: result.error, data }, { status })
  }

  return NextResponse.json({
    ok: true,
    data: {
      ...data,
      message: `Expo accepted ${result.accepted} of ${result.registered} registered device notification${result.registered === 1 ? '' : 's'}. Confirm the banner on the phone.`,
    },
  })
}
