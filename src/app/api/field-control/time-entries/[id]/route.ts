import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../../lib/auth'
import { prisma } from '../../../../../lib/prisma'

const LOCATION_EVENT_LIMIT = 1000

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'visits.review')
  if ('response' in auth) return auth.response

  const { id } = await params
  const entry = await prisma.timeEntry.findFirst({
    where: { id, organizationId: auth.user.organizationId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      visit: {
        select: {
          id: true,
          site: {
            select: {
              name: true,
              addressLine1: true,
              city: true,
              postalCode: true,
              latitude: true,
              longitude: true,
              geofenceVerifiedM: true,
              client: { select: { displayName: true } },
            },
          },
        },
      },
      locationEvents: {
        orderBy: { capturedAt: 'asc' },
        take: LOCATION_EVENT_LIMIT,
      },
      disputes: {
        where: { status: 'open' },
        select: { id: true, reason: true, createdAt: true },
      },
    },
  })

  if (!entry) return NextResponse.json({ ok: false, error: 'Time entry not found.' }, { status: 404 })

  const locationEventCount = await prisma.locationEvent.count({
    where: {
      organizationId: auth.user.organizationId,
      timeEntryId: entry.id,
    },
  })

  return NextResponse.json({
    ok: true,
    data: {
      ...entry,
      locationEventsTruncated: locationEventCount > entry.locationEvents.length,
      locationEventCount,
    },
  })
}
