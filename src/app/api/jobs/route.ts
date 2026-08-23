import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { jobCreateSchema } from '../../../modules/scheduling/schemas'
import { generateOccurrences, generationKey } from '../../../modules/scheduling/recurrence'
import { asInputJson } from '../../../modules/operations/json'

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  const jobs = await prisma.job.findMany({
    where: { organizationId: auth.user.organizationId, archivedAt: null },
    orderBy: { startDate: 'desc' },
    include: { site: { include: { client: { select: { displayName: true } } } }, servicePlanVersion: { select: { versionNumber: true } }, _count: { select: { visits: true } } },
  })
  return NextResponse.json({ ok: true, data: jobs })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth.response
  const parsed = jobCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })

  const plan = await prisma.servicePlan.findFirst({
    where: { id: parsed.data.servicePlanId, organizationId: auth.user.organizationId, archivedAt: null },
    include: { site: true, versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
  })
  if (!plan) return NextResponse.json({ ok: false, error: 'Service plan not found' }, { status: 400 })
  const planVersion = plan.versions[0]
  if (!planVersion) return NextResponse.json({ ok: false, error: 'Publish the service plan before scheduling work.' }, { status: 409 })

  const assigneeIds = [...new Set(parsed.data.assigneeIds)]
  const eligible = assigneeIds.length ? await prisma.membership.findMany({ where: { organizationId: auth.user.organizationId, userId: { in: assigneeIds }, status: 'active' }, select: { userId: true } }) : []
  if (eligible.length !== assigneeIds.length) return NextResponse.json({ ok: false, error: 'Every assignee must be an active organization member.' }, { status: 400 })

  const duration = parsed.data.durationMinutes ?? planVersion.expectedDurationMinutes
  const until = parsed.data.generateUntil ?? parsed.data.endDate ?? new Date(parsed.data.startAt.getTime() + 90 * 86_400_000)
  if (until < parsed.data.startAt) return NextResponse.json({ ok: false, error: 'Generation end must be after the start.' }, { status: 400 })
  const occurrences = generateOccurrences({ startAt: parsed.data.startAt, until, recurrence: parsed.data.recurrence })
  if (!occurrences.length) return NextResponse.json({ ok: false, error: 'Recurrence did not generate any visits.' }, { status: 400 })
  if (assigneeIds.length) {
    const finish = new Date(Math.max(...occurrences.map((start) => start.getTime() + duration * 60_000)))
    const [availability, assignedVisits] = await Promise.all([
      prisma.availability.findMany({
        where: { organizationId: auth.user.organizationId, userId: { in: assigneeIds }, cancelledAt: null, startsAt: { lt: finish }, endsAt: { gt: occurrences[0] } },
        include: { user: { select: { name: true, email: true } } },
      }),
      prisma.visitAssignment.findMany({
        where: { organizationId: auth.user.organizationId, userId: { in: assigneeIds }, status: { not: 'removed' }, visit: { status: { notIn: ['cancelled', 'completed', 'missed'] }, scheduledStart: { lt: finish }, scheduledEnd: { gt: occurrences[0] } } },
        include: { user: { select: { name: true, email: true } }, visit: { select: { scheduledStart: true, scheduledEnd: true, site: { select: { name: true, client: { select: { displayName: true } } } } } } },
      }),
    ])
    const conflicts = availability.filter((entry) => occurrences.some((start) => start < entry.endsAt && new Date(start.getTime() + duration * 60_000) > entry.startsAt))
    if (conflicts.length) return NextResponse.json({ ok: false, error: 'An assigned worker is unavailable for one or more generated visits.', code: 'ASSIGNEE_UNAVAILABLE', data: conflicts.map((entry) => ({ user: entry.user.name ?? entry.user.email, startsAt: entry.startsAt, endsAt: entry.endsAt, reason: entry.reason })) }, { status: 409 })
    const assignmentConflicts = assignedVisits.filter((assignment) => occurrences.some((start) => start < assignment.visit.scheduledEnd && new Date(start.getTime() + duration * 60_000) > assignment.visit.scheduledStart))
    if (assignmentConflicts.length) return NextResponse.json({ ok: false, error: 'An assigned worker already has work during one or more generated visits.', code: 'ASSIGNEE_OVERLAP', data: assignmentConflicts.map((assignment) => ({ user: assignment.user.name ?? assignment.user.email, startsAt: assignment.visit.scheduledStart, endsAt: assignment.visit.scheduledEnd, site: `${assignment.visit.site.client.displayName} · ${assignment.visit.site.name}` })) }, { status: 409 })
  }

  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.job.create({ data: {
      organizationId: auth.user.organizationId, contractId: plan.contractId, siteId: plan.siteId, servicePlanId: plan.id,
      servicePlanVersionId: planVersion.id, name: parsed.data.name, status: 'active', recurrence: asInputJson(parsed.data.recurrence),
      startDate: parsed.data.startAt, endDate: parsed.data.endDate, defaultDurationMin: duration, timezone: parsed.data.timezone,
      requiredWorkers: parsed.data.requiredWorkers ?? planVersion.requiredWorkers, instructions: parsed.data.instructions,
    } })
    for (let index = 0; index < occurrences.length; index += 1) {
      const start = occurrences[index]
      await tx.visit.create({ data: {
        organizationId: auth.user.organizationId, jobId: created.id, siteId: plan.siteId, servicePlanVersionId: planVersion.id,
        scheduledStart: start, scheduledEnd: new Date(start.getTime() + duration * 60_000), timezone: parsed.data.timezone,
        sequenceNumber: index + 1, generationKey: generationKey(start), requiredWorkers: parsed.data.requiredWorkers ?? planVersion.requiredWorkers,
        status: assigneeIds.length ? 'dispatched' : 'scheduled',
        assignments: { create: assigneeIds.map((userId) => ({ organizationId: auth.user.organizationId, userId, status: 'assigned' })) },
      } })
    }
    return created
  })
  await logAudit(auth.user.email, 'create_job', 'job', job.id, { visitCount: occurrences.length, siteId: plan.siteId }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { ...job, generatedVisits: occurrences.length } }, { status: 201 })
}
