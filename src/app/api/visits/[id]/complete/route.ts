import type { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { prisma } from '../../../../../lib/prisma'
import { assignedVisitFilter } from '../../../../../modules/execution/access'
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

  // Clock-out and visit submission are intentionally separate product actions.
  // A cleaner records their end location by stopping the timer first. Only when
  // every visit timer is closed can the service itself be submitted for review.
  const runningTimers = await prisma.timeEntry.findMany({
    where: {
      organizationId: auth.user.organizationId,
      visitId: visit.id,
      kind: 'visit',
      status: 'running',
    },
    select: {
      id: true,
      userId: true,
      startedAt: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { startedAt: 'asc' },
  })
  if (runningTimers.length) {
    const ownTimerRunning = runningTimers.some((timer) => timer.userId === auth.user.id)
    return NextResponse.json({
      ok: false,
      error: ownTimerRunning
        ? 'Stop your timer before submitting this visit.'
        : 'A teammate still has an active timer. The visit can be submitted after every team timer is stopped.',
      code: 'VISIT_TIMERS_STILL_RUNNING',
      data: {
        count: runningTimers.length,
        ownTimerRunning,
        workers: runningTimers.map((timer) => timer.user.name ?? timer.user.email),
      },
    }, { status: 409 })
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
      error: 'Complete the required visit items before submitting.',
      code: 'VISIT_COMPLETION_BLOCKED',
      blockers,
    }, { status: 409 })
  }

  const completedAt = parsed.data.completedAt ?? parsed.data.capturedAt ?? new Date()
  const updated = await prisma.visit.update({
    where: { id: visit.id },
    data: { status: 'completed', completedAt, version: { increment: 1 } },
    include: { taskResults: true, evidenceAssets: true, incidents: true },
  })

  await logAudit(auth.user.email, 'complete_visit', 'visit', visit.id, {
    submittedAt: completedAt,
    runningTimersAtSubmission: 0,
  }, auth.user.organizationId)

  return NextResponse.json({ ok: true, data: updated }, { status: 200 })
}
