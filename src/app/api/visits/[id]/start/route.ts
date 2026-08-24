import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { assignedVisitFilter } from '../../../../../modules/execution/access'
import { assessLocation } from '../../../../../modules/execution/location'
import { startVisitSchema } from '../../../../../modules/execution/schemas'
import { asInputJson } from '../../../../../modules/operations/json'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'visits.execute')
  if ('response' in auth) return auth.response
  const parsed = startVisitSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }
  const { id } = await params

  if (parsed.data.clientMutationId) {
    const duplicate = await prisma.timeEntry.findFirst({
      where: {
        organizationId: auth.user.organizationId,
        clientMutationId: parsed.data.clientMutationId,
        userId: auth.user.id,
        visitId: id,
      },
    })
    if (duplicate) {
      return NextResponse.json({ ok: true, duplicate: true, data: duplicate })
    }
  }

  const visit = await prisma.visit.findFirst({
    where: {
      id,
      organizationId: auth.user.organizationId,
      ...assignedVisitFilter(auth.user),
    },
    include: {
      site: true,
      servicePlanVersion: { include: { tasks: true } },
    },
  })
  if (!visit) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (['completed', 'cancelled', 'missed'].includes(visit.status)) {
    return NextResponse.json({ ok: false, error: 'This visit cannot be started.', code: 'VISIT_NOT_STARTABLE' }, { status: 409 })
  }

  const active = await prisma.timeEntry.findFirst({
    where: { organizationId: auth.user.organizationId, userId: auth.user.id, status: 'running' },
    include: { visit: { select: { id: true, scheduledStart: true } } },
  })
  if (active) {
    return NextResponse.json({
      ok: false,
      error: active.visitId === visit.id ? 'This visit timer is already running.' : 'Another timer is already running.',
      code: 'ACTIVE_TIMER',
      data: active,
    }, { status: 409 })
  }

  const startedAt = parsed.data.capturedAt ?? new Date()
  const assessment = assessLocation(visit.site, parsed.data)
  const timeEntry = await prisma.$transaction(async (tx) => {
    await tx.visitTaskResult.createMany({
      data: visit.servicePlanVersion.tasks.map((task) => ({
        organizationId: auth.user.organizationId,
        visitId: visit.id,
        versionId: visit.servicePlanVersionId,
        versionTaskId: task.id,
      })),
      skipDuplicates: true,
    })
    const created = await tx.timeEntry.create({
      data: {
        organizationId: auth.user.organizationId,
        visitId: visit.id,
        userId: auth.user.id,
        kind: 'visit',
        status: 'running',
        startedAt,
        startLatitude: parsed.data.latitude,
        startLongitude: parsed.data.longitude,
        startAccuracyM: parsed.data.accuracyM,
        startDistanceM: assessment.distanceM,
        startLocationClass: assessment.classification,
        source: parsed.data.source,
        clientMutationId: parsed.data.clientMutationId,
        reviewReason: assessment.reason,
      },
    })
    if (parsed.data.latitude != null && parsed.data.longitude != null) {
      await tx.locationEvent.create({
        data: {
          organizationId: auth.user.organizationId,
          visitId: visit.id,
          timeEntryId: created.id,
          kind: 'clock_in',
          latitude: parsed.data.latitude,
          longitude: parsed.data.longitude,
          accuracyM: parsed.data.accuracyM,
          distanceM: assessment.distanceM,
          classification: assessment.classification,
          capturedAt: startedAt,
          source: parsed.data.source,
        },
      })
    }
    await tx.visit.update({
      where: { id: visit.id },
      data: { status: 'in_progress', startedAt: visit.startedAt ?? startedAt, version: { increment: 1 } },
    })
    if (parsed.data.clientMutationId && parsed.data.deviceId) {
      await tx.offlineMutation.upsert({
        where: { organizationId_clientMutationId: { organizationId: auth.user.organizationId, clientMutationId: parsed.data.clientMutationId } },
        update: { status: 'duplicate', result: asInputJson({ timeEntryId: created.id }) },
        create: {
          organizationId: auth.user.organizationId,
          userId: auth.user.id,
          clientMutationId: parsed.data.clientMutationId,
          deviceId: parsed.data.deviceId,
          mutationType: 'visit.start',
          entityId: visit.id,
          payload: asInputJson(JSON.parse(JSON.stringify(parsed.data)))!,
          result: asInputJson({ timeEntryId: created.id }),
          clientCreatedAt: startedAt,
        },
      })
    }
    return created
  })

  await logAudit(auth.user.email, 'start_visit', 'visit', visit.id, {
    timeEntryId: timeEntry.id,
    distanceM: assessment.distanceM,
    locationClass: assessment.classification,
  }, auth.user.organizationId)
  return NextResponse.json({
    ok: true,
    data: timeEntry,
    location: assessment,
    warning: assessment.reviewRequired ? assessment.reason : null,
  }, { status: 201 })
}
