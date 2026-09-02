import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { prisma } from '../../../../../lib/prisma'
import { assignedVisitFilter } from '../../../../../modules/execution/access'
import { assessLocation } from '../../../../../modules/execution/location'
import { completeVisitSchema } from '../../../../../modules/execution/schemas'

function evidencePhase(metadata: Prisma.JsonValue): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const phase = (metadata as Record<string, Prisma.JsonValue>).phase
  return typeof phase === 'string' ? phase : null
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'visits.execute')
  if ('response' in auth) return auth.response
  const parsed = completeVisitSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  const { id } = await params
  const visit = await prisma.visit.findFirst({
    where: { id, organizationId: auth.user.organizationId, ...assignedVisitFilter(auth.user) },
    include: {
      site: true,
      servicePlanVersion: { include: { tasks: { orderBy: { sortOrder: 'asc' } } } },
      taskResults: { include: { evidence: true, versionTask: true } },
      evidenceAssets: true,
      incidents: { where: { status: { notIn: ['resolved', 'closed'] } } },
      job: { include: { servicePlan: { include: { evidencePolicy: true } } } },
    },
  })
  if (!visit) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (visit.status === 'completed') return NextResponse.json({ ok: true, duplicate: true, data: visit })
  if (['cancelled', 'missed'].includes(visit.status)) {
    return NextResponse.json({ ok: false, error: 'This visit cannot be completed.', code: 'VISIT_NOT_COMPLETABLE' }, { status: 409 })
  }

  const resultByTaskId = new Map(visit.taskResults.map((result) => [result.versionTaskId, result]))
  const blockers: Array<{ code: string; taskId?: string; label: string }> = []
  for (const task of visit.servicePlanVersion.tasks) {
    const result = resultByTaskId.get(task.id)
    if (task.required && (!result || result.status === 'pending')) {
      blockers.push({ code: 'REQUIRED_TASK_PENDING', taskId: result?.id, label: task.title })
      continue
    }
    if (!result) continue
    if (result.status === 'problem' && task.critical) {
      blockers.push({ code: 'CRITICAL_TASK_PROBLEM', taskId: result.id, label: task.title })
    }
    if (task.evidenceRequired && result.evidence.length === 0) {
      blockers.push({ code: 'TASK_EVIDENCE_REQUIRED', taskId: result.id, label: task.title })
    }
    if (task.responseType === 'signature' && !result.evidence.some((asset) => asset.kind === 'signature')) {
      blockers.push({ code: 'SIGNATURE_REQUIRED', taskId: result.id, label: task.title })
    }
    if (result.status === 'problem' && visit.job.servicePlan.evidencePolicy?.requireProblemPhoto
      && !result.evidence.some((asset) => asset.kind === 'photo')) {
      blockers.push({ code: 'PROBLEM_PHOTO_REQUIRED', taskId: result.id, label: task.title })
    }
  }
  const policy = visit.job.servicePlan.evidencePolicy
  const photos = visit.evidenceAssets.filter((asset) => asset.kind === 'photo')
  if (policy) {
    if (photos.length < policy.minimumPhotoCount) {
      blockers.push({ code: 'MINIMUM_PHOTOS_REQUIRED', label: `${policy.minimumPhotoCount} visit photos` })
    }
    if (policy.requireStartPhoto && !photos.some((asset) => evidencePhase(asset.metadata) === 'start')) {
      blockers.push({ code: 'START_PHOTO_REQUIRED', label: 'Start photo' })
    }
    if (policy.requireFinishPhoto && !photos.some((asset) => evidencePhase(asset.metadata) === 'finish')) {
      blockers.push({ code: 'FINISH_PHOTO_REQUIRED', label: 'Finish photo' })
    }
    if (policy.requireSignature && !visit.evidenceAssets.some((asset) => asset.kind === 'signature')) {
      blockers.push({ code: 'VISIT_SIGNATURE_REQUIRED', label: 'Client signature' })
    }
  }
  for (const incident of visit.incidents.filter((item) => item.severity === 'critical')) {
    blockers.push({ code: 'CRITICAL_INCIDENT_OPEN', label: incident.title })
  }
  if (blockers.length) {
    if (visit.status !== 'completion_blocked') {
      await prisma.visit.update({ where: { id: visit.id }, data: { status: 'completion_blocked', version: { increment: 1 } } })
    }
    return NextResponse.json({
      ok: false,
      error: 'Complete the required visit items before finishing.',
      code: 'VISIT_COMPLETION_BLOCKED',
      blockers,
    }, { status: 409 })
  }

  const completedAt = parsed.data.completedAt ?? parsed.data.capturedAt ?? new Date()
  const actorTimer = await prisma.timeEntry.findFirst({
    where: { organizationId: auth.user.organizationId, visitId: visit.id, userId: auth.user.id, status: 'running' },
  })
  const assessment = actorTimer ? assessLocation(visit.site, parsed.data) : null
  const otherRunningTimers = await prisma.timeEntry.count({
    where: { organizationId: auth.user.organizationId, visitId: visit.id, status: 'running', userId: { not: auth.user.id } },
  })
  const updated = await prisma.$transaction(async (tx) => {
    if (actorTimer) {
      const durationSeconds = Math.max(0, Math.round((completedAt.getTime() - actorTimer.startedAt.getTime()) / 1000))
      const reviewReasons = [
        actorTimer.reviewReason,
        assessment?.reviewRequired ? assessment.reason : null,
      ].filter(Boolean)
      await tx.timeEntry.update({
        where: { id: actorTimer.id },
        data: {
          status: reviewReasons.length ? 'needs_review' : 'completed',
          endedAt: completedAt,
          durationSeconds,
          endLatitude: parsed.data.latitude,
          endLongitude: parsed.data.longitude,
          endAccuracyM: parsed.data.accuracyM,
          endDistanceM: assessment?.distanceM,
          endLocationClass: assessment?.classification,
          reviewReason: reviewReasons.join(', ') || null,
        },
      })
      if (parsed.data.latitude != null && parsed.data.longitude != null && assessment) {
        await tx.locationEvent.create({
          data: {
            organizationId: auth.user.organizationId,
            visitId: visit.id,
            timeEntryId: actorTimer.id,
            kind: 'clock_out',
            latitude: parsed.data.latitude,
            longitude: parsed.data.longitude,
            accuracyM: parsed.data.accuracyM,
            distanceM: assessment.distanceM,
            classification: assessment.classification,
            capturedAt: completedAt,
            source: parsed.data.source,
          },
        })
      }
    }
    return tx.visit.update({
      where: { id: visit.id },
      data: { status: 'completed', completedAt, version: { increment: 1 } },
      include: { taskResults: true, evidenceAssets: true, incidents: true },
    })
  })
  await logAudit(auth.user.email, 'complete_visit', 'visit', visit.id, {
    actorTimeEntryId: actorTimer?.id,
    otherRunningTimers,
    endLocationClass: assessment?.classification,
  }, auth.user.organizationId)
  return NextResponse.json({
    ok: true,
    data: updated,
    warnings: otherRunningTimers ? [{ code: 'TEAM_TIMERS_STILL_RUNNING', count: otherRunningTimers }] : [],
  })
}
