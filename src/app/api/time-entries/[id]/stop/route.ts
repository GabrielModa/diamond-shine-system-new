import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { prisma } from '../../../../../lib/prisma'
import { canManageTeamTime } from '../../../../../modules/execution/access'
import { assessLocation } from '../../../../../modules/execution/location'
import { repeatedLocationPattern } from '../../../../../modules/execution/location-pattern'
import { stopTimeEntrySchema } from '../../../../../modules/execution/schemas'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!canManageTeamTime(user) && user.membershipRole !== 'employee') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  const parsed = stopTimeEntrySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  const { id } = await params
  const entry = await prisma.timeEntry.findFirst({
    where: { id, organizationId: user.organizationId },
    include: { visit: { include: { site: true, servicePlanVersion: true } } },
  })
  if (!entry) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (entry.userId !== user.id && !canManageTeamTime(user)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  if (entry.status !== 'running') return NextResponse.json({ ok: true, duplicate: true, data: entry })

  const endedAt = parsed.data.endedAt ?? parsed.data.capturedAt ?? new Date()
  if (endedAt < entry.startedAt) return NextResponse.json({ ok: false, error: 'End time cannot precede start time.' }, { status: 400 })
  const assessment = entry.visit
    ? assessLocation(entry.visit.site, parsed.data)
    : { classification: 'unavailable' as const, distanceM: null, accuracyM: null, confidence: 'low' as const, risk: 'watch' as const, reviewRequired: false, reason: null }
  const pattern = entry.visit
    ? await repeatedLocationPattern({
        organizationId: user.organizationId,
        userId: entry.userId,
        siteId: entry.visit.siteId,
        kind: 'clock_out',
        capturedAt: endedAt,
        coordinates: parsed.data,
        assessment,
      })
    : { count: 0, triggered: false, windowDays: 30, clusterRadiusM: 175 }
  const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - entry.startedAt.getTime()) / 1000))
  const locationReviewReason = pattern.triggered
    ? 'REPEATED_LOCATION_PATTERN'
    : assessment.reviewRequired ? assessment.reason : null
  const reviewReasons = [entry.reviewReason, locationReviewReason].filter(Boolean)

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.timeEntry.update({
      where: { id: entry.id },
      data: {
        status: reviewReasons.length ? 'needs_review' : 'completed',
        endedAt,
        durationSeconds,
        endLatitude: parsed.data.latitude,
        endLongitude: parsed.data.longitude,
        endAccuracyM: parsed.data.accuracyM,
        endDistanceM: assessment.distanceM,
        endLocationClass: assessment.classification,
        reviewReason: reviewReasons.join(', ') || null,
      },
    })
    if (entry.visitId && parsed.data.latitude != null && parsed.data.longitude != null) {
      await tx.locationEvent.create({
        data: {
          organizationId: user.organizationId,
          visitId: entry.visitId,
          timeEntryId: entry.id,
          kind: 'clock_out',
          latitude: parsed.data.latitude,
          longitude: parsed.data.longitude,
          accuracyM: parsed.data.accuracyM,
          distanceM: assessment.distanceM,
          classification: assessment.classification,
          capturedAt: endedAt,
          source: parsed.data.source,
        },
      })
    }
    return saved
  })
  await logAudit(user.email, 'stop_time_entry', 'time_entry', entry.id, {
    status: updated.status,
    durationSeconds,
    reviewReason: updated.reviewReason,
    locationRisk: assessment.risk,
    repeatedLocationPatternCount: pattern.count,
  }, user.organizationId)
  return NextResponse.json({ ok: true, data: updated, location: assessment, pattern })
}
