import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireCapabilities } from '../../../../../lib/auth'
import { isManualExtraRecurrence } from '../../../../../modules/operations/client-lifecycle'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../../../modules/scheduling/assignment-lifecycle'
import { cancelVisits, CANCELLABLE_VISIT_STATUSES } from '../../../../../modules/scheduling/cancel-visits'
import { generateOccurrences, generationKey } from '../../../../../modules/scheduling/recurrence'
import { recurrenceSchema } from '../../../../../modules/scheduling/schemas'

const schema = z.object({
  servicePlanId: z.string().min(1),
  effectiveFrom: z.string().datetime().transform((value) => new Date(value)),
  reason: z.string().trim().min(1).max(2000),
})

const OPERATIONAL_VISIT_STATUSES = ['scheduled', 'dispatched', 'acknowledged', 'in_progress', 'completion_blocked'] as const

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapabilities(request, ['clients.manage', 'service_plans.manage', 'schedule.manage'])
  if ('response' in auth) return auth.response

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Choose an effective date and provide a reason.', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { id: clientId } = await params
  const { servicePlanId, effectiveFrom, reason } = parsed.data
  const organizationId = auth.user.organizationId
  const preview = request.nextUrl.searchParams.get('preview') === 'true'
  const now = new Date()

  if (effectiveFrom < new Date(now.getTime() - 5 * 60_000)) {
    return NextResponse.json({ ok: false, error: 'The end boundary cannot be in the past.' }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM clients WHERE id = ${clientId} AND "organizationId" = ${organizationId} FOR UPDATE`

      const plan = await tx.servicePlan.findFirst({
        where: {
          id: servicePlanId,
          organizationId,
          archivedAt: null,
          site: { clientId, archivedAt: null, client: { archivedAt: null } },
        },
        include: {
          contract: { select: { id: true, status: true, endDate: true } },
          jobs: { where: { archivedAt: null } },
        },
      })
      if (!plan) throw new Error('Active service not found for this client.')

      const recurringJobs = plan.jobs.filter((job) =>
        ['active', 'paused'].includes(job.status)
        && !isManualExtraRecurrence(job.recurrence)
        && (!job.endDate || job.endDate > now),
      )
      if (!recurringJobs.length) throw new Error('This service has no current recurring schedule to end.')

      const recurringJobIds = recurringJobs.map((job) => job.id)
      const manualExtraJobIds = plan.jobs.filter((job) => isManualExtraRecurrence(job.recurrence)).map((job) => job.id)

      const [affected, runningBlockers, materializedBoundaryVisits, manualExtraVisits, historicalVisits] = await Promise.all([
        tx.visit.findMany({
          where: {
            organizationId,
            jobId: { in: recurringJobIds },
            scheduledStart: { gte: effectiveFrom },
            status: { in: [...CANCELLABLE_VISIT_STATUSES] },
          },
          include: {
            assignments: {
              where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
              select: { userId: true },
            },
          },
          orderBy: { scheduledStart: 'asc' },
        }),
        tx.visit.findMany({
          where: {
            organizationId,
            jobId: { in: recurringJobIds },
            status: { in: ['in_progress', 'completion_blocked'] },
            scheduledEnd: { gt: effectiveFrom },
          },
          select: { id: true, scheduledStart: true, scheduledEnd: true, status: true },
        }),
        tx.visit.findMany({
          where: {
            organizationId,
            jobId: { in: recurringJobIds },
            scheduledStart: { lt: effectiveFrom },
            scheduledEnd: { gt: effectiveFrom },
          },
          select: { id: true, jobId: true, generationKey: true, scheduledStart: true, scheduledEnd: true, status: true },
        }),
        manualExtraJobIds.length
          ? tx.visit.count({ where: { organizationId, jobId: { in: manualExtraJobIds } } })
          : Promise.resolve(0),
        tx.visit.count({
          where: {
            organizationId,
            jobId: { in: recurringJobIds },
            OR: [{ scheduledStart: { lt: now } }, { status: { in: ['completed', 'cancelled', 'missed'] } }],
          },
        }),
      ])

      const boundaryBlockers = materializedBoundaryVisits.filter((visit) =>
        OPERATIONAL_VISIT_STATUSES.includes(visit.status as (typeof OPERATIONAL_VISIT_STATUSES)[number]))
      const materializedBoundaryKeys = new Set(
        materializedBoundaryVisits.map((visit) => `${visit.jobId}:${visit.generationKey}`),
      )
      const syntheticBoundaryBlockers = recurringJobs.flatMap((job) => {
        const rule = recurrenceSchema.safeParse(job.recurrence)
        if (!rule.success) return []

        const durationMs = job.defaultDurationMin * 60_000
        const from = new Date(Math.max(job.startDate.getTime(), effectiveFrom.getTime() - durationMs))
        const until = job.endDate && job.endDate < effectiveFrom ? job.endDate : effectiveFrom
        if (until <= from) return []

        return generateOccurrences({
          startAt: job.startDate,
          from,
          until,
          timezone: job.timezone,
          recurrence: rule.data,
          limit: 8,
        })
          .filter((date) => date < effectiveFrom && date.getTime() + durationMs > effectiveFrom.getTime())
          .filter((date) => !materializedBoundaryKeys.has(`${job.id}:${generationKey(date)}`))
          .map((date) => ({
            id: `expected:${job.id}:${generationKey(date)}`,
            scheduledStart: date,
            scheduledEnd: new Date(date.getTime() + durationMs),
            status: 'expected' as const,
          }))
      })

      const blockerMap = new Map(
        [...runningBlockers, ...boundaryBlockers, ...syntheticBoundaryBlockers].map((visit) => [visit.id, visit]),
      )
      const blockers = [...blockerMap.values()]

      const horizon = new Date(effectiveFrom.getTime() + 90 * 86_400_000)
      const expectedOccurrences = recurringJobs.reduce((sum, job) => {
        const rule = recurrenceSchema.safeParse(job.recurrence)
        if (!rule.success) return sum
        const until = job.endDate && job.endDate < horizon ? job.endDate : horizon
        if (until <= effectiveFrom) return sum
        return sum + generateOccurrences({
          startAt: job.startDate,
          from: effectiveFrom,
          until,
          timezone: job.timezone,
          recurrence: rule.data,
          limit: 100,
        }).filter((date) => date >= effectiveFrom && date < until).length
      }, 0)

      const impact = {
        canApply: blockers.length === 0,
        futureRecurringObligations: expectedOccurrences,
        forecastDays: 90,
        futureRecurringVisits: affected.length,
        assignedCleaners: new Set(affected.flatMap((visit) => visit.assignments.map((assignment) => assignment.userId))).size,
        blockers,
        manualExtraVisits,
        historicalVisits,
        effectiveFrom,
      }
      if (preview) return impact
      if (blockers.length) {
        throw new Error('A visit crosses the service end boundary or is already in progress. Finish it or choose a later end time.')
      }

      // endDate is the authoritative recurrence boundary. Do not eagerly materialize
      // months of visits here: normal continuity will keep generating work before this
      // boundary and will never generate an occurrence starting at/after it.
      for (const job of recurringJobs) {
        const immediate = effectiveFrom <= now
        const nextEnd = job.endDate && job.endDate < effectiveFrom ? job.endDate : effectiveFrom
        const changed = await tx.job.updateMany({
          where: { id: job.id, organizationId, status: job.status, version: job.version },
          data: {
            status: immediate ? 'completed' : job.status,
            endDate: nextEnd,
            version: { increment: 1 },
          },
        })
        if (changed.count !== 1) throw new Error('Service changed. Refresh the preview and try again.')
      }

      if (plan.contract) {
        const nextContractEnd = plan.contract.endDate && plan.contract.endDate < effectiveFrom
          ? plan.contract.endDate
          : effectiveFrom
        await tx.contract.update({
          where: { id: plan.contract.id },
          data: {
            endDate: nextContractEnd,
            ...(effectiveFrom <= now ? { status: 'ended' as const } : {}),
            version: { increment: 1 },
          },
        })
      }

      await cancelVisits(tx, {
        organizationId,
        ids: affected.map((visit) => visit.id),
        reason: `Service ended: ${reason}`,
        now,
      })

      for (const visit of affected) {
        const userIds = [...new Set(visit.assignments.map((assignment) => assignment.userId))]
        if (!userIds.length) continue

        const title = 'Recurring visit cancelled'
        const body = `Service ${plan.name} ends from ${effectiveFrom.toISOString()}. Your visit on ${visit.scheduledStart.toISOString()} is cancelled. Reason: ${reason}`
        const notice = await tx.operationalNotice.create({
          data: {
            organizationId,
            siteId: visit.siteId,
            visitId: visit.id,
            type: 'schedule_change',
            priority: 'high',
            title,
            body,
            requiresAcknowledgement: true,
            createdById: auth.user.id,
            recipients: { create: userIds.map((userId) => ({ organizationId, userId })) },
          },
        })
        await tx.notificationJob.create({
          data: {
            organizationId,
            kind: 'operational_notice_push',
            createdBy: auth.user.email,
            entityType: 'operational_notice',
            entityId: notice.id,
            nextAttemptAt: now,
            payload: { userIds, title, body, noticeId: notice.id, priority: 'high' },
          },
        })
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          actorEmail: auth.user.email,
          action: 'end_client_service',
          targetType: 'service_plan',
          targetId: plan.id,
          metadata: JSON.stringify({
            clientId,
            reason,
            effectiveFrom,
            recurringJobIds,
            cancelledVisitIds: affected.map((visit) => visit.id),
            manualExtraVisits,
            futureDated: effectiveFrom > now,
          }),
        },
      })

      return impact
    }, { isolationLevel: 'Serializable', timeout: 30_000 })

    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    const message = error instanceof Error && !('code' in error)
      ? error.message
      : 'Service changed while applying this operation. Refresh the preview and retry.'
    return NextResponse.json({ ok: false, error: message }, { status: 409 })
  }
}
