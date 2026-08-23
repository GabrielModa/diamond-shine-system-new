import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser, requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { prisma } from '../../../lib/prisma'
import { startTimeEntrySchema } from '../../../modules/execution/schemas'

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(['running', 'completed', 'needs_review', 'approved', 'rejected']).optional(),
  userId: z.string().optional(),
  mine: z.coerce.boolean().optional(),
})

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  if (user.membershipRole !== 'employee' && !parsed.data.mine) {
    const managerAuth = await requireCapability(request, 'time.team.review')
    if ('response' in managerAuth) return managerAuth.response
  }
  const from = parsed.data.from ?? new Date(Date.now() - 30 * 86_400_000)
  const to = parsed.data.to ?? new Date(Date.now() + 86_400_000)
  const entries = await prisma.timeEntry.findMany({
    where: {
      organizationId: user.organizationId,
      startedAt: { gte: from, lte: to },
      status: parsed.data.status,
      userId: user.membershipRole === 'employee' || parsed.data.mine ? user.id : parsed.data.userId,
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      visit: {
        select: {
          id: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          site: { select: { id: true, name: true, client: { select: { id: true, displayName: true } } } },
        },
      },
      locationEvents: {
        select: { id: true, kind: true, capturedAt: true, distanceM: true, accuracyM: true, classification: true, source: true },
        orderBy: { capturedAt: 'asc' },
      },
      disputes: {
        select: { id: true, reason: true, status: true, resolution: true, resolvedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { startedAt: 'desc' },
    take: 500,
  })
  return NextResponse.json({ ok: true, data: entries })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'visits.execute')
  if ('response' in auth) return auth.response
  const parsed = startTimeEntrySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })

  if (parsed.data.clientMutationId) {
    const duplicate = await prisma.timeEntry.findFirst({
      where: { organizationId: auth.user.organizationId, clientMutationId: parsed.data.clientMutationId },
      include: { locationEvents: true },
    })
    if (duplicate) return NextResponse.json({ ok: true, data: duplicate, duplicate: true })
  }
  const running = await prisma.timeEntry.findFirst({
    where: { organizationId: auth.user.organizationId, userId: auth.user.id, status: 'running' },
    select: { id: true, kind: true },
  })
  if (running) return NextResponse.json({ ok: false, error: `Stop the current ${running.kind} timer before starting another.`, code: 'TIMER_ALREADY_RUNNING' }, { status: 409 })

  const startedAt = parsed.data.startedAt ?? parsed.data.capturedAt ?? new Date()
  const hasLocation = parsed.data.latitude != null && parsed.data.longitude != null
  const entry = await prisma.timeEntry.create({
    data: {
      organizationId: auth.user.organizationId,
      userId: auth.user.id,
      kind: parsed.data.kind,
      status: 'running',
      startedAt,
      startLatitude: parsed.data.latitude,
      startLongitude: parsed.data.longitude,
      startAccuracyM: parsed.data.accuracyM,
      startLocationClass: hasLocation ? 'unavailable' : null,
      source: parsed.data.source,
      clientMutationId: parsed.data.clientMutationId,
      locationEvents: hasLocation ? { create: {
        organizationId: auth.user.organizationId,
        kind: 'clock_in',
        latitude: parsed.data.latitude!,
        longitude: parsed.data.longitude!,
        accuracyM: parsed.data.accuracyM,
        classification: 'unavailable',
        capturedAt: parsed.data.capturedAt ?? startedAt,
        source: parsed.data.source,
      } } : undefined,
    },
    include: { locationEvents: true },
  })
  await logAudit(auth.user.email, 'start_time_entry', 'time_entry', entry.id, { kind: entry.kind, source: entry.source }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: entry }, { status: 201 })
}
