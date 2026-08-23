import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { availabilityCreateSchema, availabilityQuerySchema } from '../../../modules/scheduling/schemas'

async function hasScheduleManagement(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.manage')
  return !('response' in auth)
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const parsed = availabilityQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  const manager = await hasScheduleManagement(request)
  const requestedUserId = parsed.data.userId
  if (requestedUserId && requestedUserId !== auth.user.id && !manager) return NextResponse.json({ ok: false, error: 'Not allowed to view this availability.' }, { status: 403 })
  const from = parsed.data.from ?? new Date(Date.now() - 7 * 86_400_000)
  const to = parsed.data.to ?? new Date(Date.now() + 90 * 86_400_000)
  const entries = await prisma.availability.findMany({
    where: {
      organizationId: auth.user.organizationId,
      cancelledAt: null,
      ...(manager && !requestedUserId ? {} : { userId: requestedUserId ?? auth.user.id }),
      startsAt: { lt: to }, endsAt: { gt: from },
    },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { startsAt: 'asc' },
  })
  return NextResponse.json({ ok: true, data: entries })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const parsed = availabilityCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid availability', details: parsed.error.flatten() }, { status: 400 })
  const userId = parsed.data.userId ?? auth.user.id
  if (userId !== auth.user.id && !(await hasScheduleManagement(request))) return NextResponse.json({ ok: false, error: 'Not allowed to set availability for this person.' }, { status: 403 })
  const member = await prisma.membership.findFirst({ where: { organizationId: auth.user.organizationId, userId, status: 'active' }, select: { id: true } })
  if (!member) return NextResponse.json({ ok: false, error: 'Active team member not found.' }, { status: 404 })
  const entry = await prisma.availability.create({ data: { organizationId: auth.user.organizationId, userId, startsAt: parsed.data.startsAt, endsAt: parsed.data.endsAt, reason: parsed.data.reason }, include: { user: { select: { id: true, name: true, email: true } } } })
  await logAudit(auth.user.email, 'declare_unavailability', 'availability', entry.id, { userId, startsAt: entry.startsAt, endsAt: entry.endsAt }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: entry }, { status: 201 })
}
