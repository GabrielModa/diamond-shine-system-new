import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../../lib/auth'
import { prisma } from '../../../../../lib/prisma'
import { assessLocation } from '../../../../../modules/execution/location'
import { heartbeatSchema } from '../../../../../modules/execution/schemas'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'time.own.manage')
  if ('response' in auth) return auth.response
  const parsed = heartbeatSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  if (parsed.data.latitude == null || parsed.data.longitude == null) {
    return NextResponse.json({ ok: false, error: 'Location is required for a waypoint.' }, { status: 400 })
  }
  const { id } = await params
  const entry = await prisma.timeEntry.findFirst({
    where: { id, organizationId: auth.user.organizationId, userId: auth.user.id, kind: 'visit', status: 'running' },
    include: { visit: { include: { site: true } } },
  })
  if (!entry?.visit) return NextResponse.json({ ok: false, error: 'Active visit timer not found' }, { status: 404 })
  const capturedAt = parsed.data.capturedAt ?? new Date()
  const latest = await prisma.locationEvent.findFirst({
    where: { organizationId: auth.user.organizationId, timeEntryId: entry.id, kind: 'heartbeat' },
    orderBy: { capturedAt: 'desc' },
  })
  if (latest && capturedAt.getTime() - latest.capturedAt.getTime() < 60_000) {
    return NextResponse.json({ ok: true, ignored: true, data: latest })
  }

  const assessment = assessLocation(entry.visit.site, parsed.data)
  const reviewReason = assessment.reviewRequired ? 'PRESENCE_LOCATION_ANOMALY' : null
  const waypoint = await prisma.$transaction(async (tx) => {
    if (reviewReason && !entry.reviewReason?.includes(reviewReason)) {
      await tx.timeEntry.update({
        where: { id: entry.id },
        data: { reviewReason: [entry.reviewReason, reviewReason].filter(Boolean).join(', ') },
      })
    }

    const locationData = {
      latitude: parsed.data.latitude!,
      longitude: parsed.data.longitude!,
      accuracyM: parsed.data.accuracyM,
      distanceM: assessment.distanceM,
      classification: assessment.classification,
      capturedAt,
      source: parsed.data.source,
    }

    if (latest && latest.classification === assessment.classification) {
      return tx.locationEvent.update({ where: { id: latest.id }, data: locationData })
    }

    return tx.locationEvent.create({
      data: {
        organizationId: auth.user.organizationId,
        visitId: entry.visit.id,
        timeEntryId: entry.id,
        kind: 'heartbeat',
        ...locationData,
      },
    })
  })
  return NextResponse.json({ ok: true, data: waypoint, location: assessment, warning: reviewReason }, { status: latest?.classification === assessment.classification ? 200 : 201 })
}
