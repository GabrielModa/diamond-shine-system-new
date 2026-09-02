import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '../../../../../lib/auth'
import { prisma } from '../../../../../lib/prisma'
import { assignedVisitFilter } from '../../../../../modules/execution/access'
import { assessLocation } from '../../../../../modules/execution/location'

const schema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(10_000).nullable().optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'visits.execute')
  if ('response' in auth) return auth.response

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'A current GPS position is required.' }, { status: 400 })

  const { id } = await params
  const visit = await prisma.visit.findFirst({
    where: { id, organizationId: auth.user.organizationId, ...assignedVisitFilter(auth.user) },
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
    },
  })
  if (!visit) return NextResponse.json({ ok: false, error: 'Visit not found or not assigned to you.' }, { status: 404 })

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
