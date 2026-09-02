import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '../../../../../lib/auth'
import { prisma } from '../../../../../lib/prisma'
import { assessLocation } from '../../../../../modules/execution/location'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../../../modules/scheduling/assignment-lifecycle'

const schema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(10_000).nullable().optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'A current GPS position is required.' }, { status: 400 })

  const { id } = await params
  const visit = await prisma.visit.findFirst({
    where: { id, organizationId: user.organizationId },
    select: {
      id: true,
      site: {
        select: {
          id: true,
          name: true,
          latitude: true,
          longitude: true,
          geofenceVerifiedM: true,
          geofenceNearM: true,
          geofenceSuspiciousM: true,
        },
      },
      assignments: {
        where: { userId: user.id, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
        select: { id: true },
      },
    },
  })
  if (!visit) return NextResponse.json({ ok: false, error: 'Visit not found.' }, { status: 404 })

  const fieldRole = user.membershipRole === 'employee' || user.membershipRole === 'field_supervisor'
  if (fieldRole && !visit.assignments.length) {
    return NextResponse.json({ ok: false, error: 'This visit is not actively assigned to you.' }, { status: 403 })
  }

  const assessment = assessLocation(visit.site, parsed.data)
  return NextResponse.json({
    ok: true,
    data: {
      assessment,
      geofence: {
        verifiedM: visit.site.geofenceVerifiedM,
        nearM: visit.site.geofenceNearM,
        suspiciousM: visit.site.geofenceSuspiciousM,
      },
    },
  })
}
