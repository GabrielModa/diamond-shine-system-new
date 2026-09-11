import { NextRequest, NextResponse } from 'next/server'
import { authUserHasCapability, getAuthUser } from '../../../../lib/auth'
import { prisma } from '../../../../lib/prisma'

const LOCATION_EVENT_LIMIT = 500

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const owner = await prisma.timeEntry.findFirst({
    where: { id, organizationId: user.organizationId },
    select: { userId: true },
  })
  if (!owner) return NextResponse.json({ ok: false, error: 'Time entry not found.' }, { status: 404 })
  if (owner.userId !== user.id && !authUserHasCapability(user, 'time.team.review')) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  const entry = await prisma.timeEntry.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      kind: true,
      status: true,
      startedAt: true,
      endedAt: true,
      durationSeconds: true,
      payableSeconds: true,
      startLocationClass: true,
      endLocationClass: true,
      reviewReason: true,
      user: { select: { id: true, name: true, email: true } },
      visit: {
        select: {
          id: true,
          status: true,
          site: {
            select: {
              id: true,
              name: true,
              client: { select: { id: true, displayName: true } },
            },
          },
        },
      },
      locationEvents: {
        select: {
          id: true,
          kind: true,
          capturedAt: true,
          distanceM: true,
          accuracyM: true,
          classification: true,
          source: true,
        },
        orderBy: { capturedAt: 'asc' },
        take: LOCATION_EVENT_LIMIT,
      },
      disputes: {
        select: { id: true, reason: true, status: true, resolution: true, resolvedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  const locationEventCount = await prisma.locationEvent.count({
    where: { organizationId: user.organizationId, timeEntryId: id },
  })

  return NextResponse.json({
    ok: true,
    data: {
      ...entry,
      locationEventCount,
      locationEventsTruncated: locationEventCount > entry.locationEvents.length,
    },
  })
}
