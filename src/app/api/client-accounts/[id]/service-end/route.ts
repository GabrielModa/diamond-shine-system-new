import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireCapabilities } from '../../../../../lib/auth'
import { isManualExtraRecurrence } from '../../../../../modules/operations/client-lifecycle'
import { ACTIVE_ASSIGNMENT_STATUSES } from '../../../../../modules/scheduling/assignment-lifecycle'
import { cancelVisits, CANCELLABLE_VISIT_STATUSES } from '../../../../../modules/scheduling/cancel-visits'
import { ensureJobContinuity } from '../../../../../modules/scheduling/continuity'
import { generateOccurrences } from '../../../../../modules/scheduling/recurrence'
import { recurrenceSchema } from '../../../../../modules/scheduling/schemas'

const schema = z.object({ servicePlanId: z.string().min(1), effectiveFrom: z.string().datetime().transform(v => new Date(v)), reason: z.string().trim().min(1).max(2000) })

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapabilities(request, ['clients.manage', 'service_plans.manage', 'schedule.manage'])
  if ('response' in auth) return auth.response
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Choose an effective date and provide a reason.', details: parsed.error.flatten() }, { status: 400 })
  const { id: clientId } = await params
  const { servicePlanId, effectiveFrom, reason } = parsed.data
  const organizationId = auth.user.organizationId
  const preview = request.nextUrl.searchParams.get('preview') === 'true'
  const now = new Date()
  if (effectiveFrom < new Date(now.getTime() - 5 * 60_000)) return NextResponse.json({ ok: false, error: 'The end boundary cannot be in the past.' }, { status: 400 })
  try {
    const result = await prisma.$transaction(async tx => {
      // Serialize lifecycle decisions against this account and service.
      await tx.$queryRaw`SELECT id FROM clients WHERE id = ${clientId} AND "organizationId" = ${organizationId} FOR UPDATE`
      const plan = await tx.servicePlan.findFirst({
        where: { id: servicePlanId, organizationId, archivedAt: null, site: { clientId, archivedAt: null, client: { archivedAt: null } } },
        include: { jobs: { where: { archivedAt: null } } },
      })
      if (!plan) throw new Error('Active service not found for this client.')
      const jobs = plan.jobs.filter(j => ['active', 'paused'].includes(j.status) && !isManualExtraRecurrence(j.recurrence))
      if (!jobs.length) throw new Error('This service has no active schedule to end.')
      const ids = jobs.map(j => j.id)
      const [affected, blockers, manualExtraVisits, historicalVisits] = await Promise.all([
        tx.visit.findMany({ where: { organizationId, jobId: { in: ids }, scheduledStart: { gte: effectiveFrom > now ? effectiveFrom : now }, status: { in: [...CANCELLABLE_VISIT_STATUSES] } },
          include: { assignments: { where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } }, select: { userId: true } } } }),
        tx.visit.findMany({ where: { organizationId, jobId: { in: ids }, scheduledEnd: { gt: effectiveFrom }, status: { in: ['in_progress', 'completion_blocked'] } }, select: { id: true } }),
        tx.visit.count({ where: { organizationId, jobId: { in: plan.jobs.filter(j => isManualExtraRecurrence(j.recurrence)).map(j => j.id) } } }),
        tx.visit.count({ where: { organizationId, jobId: { in: ids }, OR: [{ scheduledStart: { lt: now } }, { status: 'completed' }] } }),
      ])
      // Open-ended recurrence is unbounded; report a clearly labelled window.
      const horizon = new Date(effectiveFrom.getTime() + 90 * 86_400_000)
      const expectedOccurrences = jobs.reduce((sum, job) => {
        const rule = recurrenceSchema.safeParse(job.recurrence)
        if (!rule.success) return sum
        const until = job.endDate && job.endDate < horizon ? job.endDate : horizon
        if (until <= effectiveFrom) return sum
        return sum + generateOccurrences({ startAt: job.startDate, from: effectiveFrom, until, timezone: job.timezone, recurrence: rule.data, limit: 100 }).filter(d => d >= effectiveFrom && d < until).length
      }, 0)
      const impact = { canApply: blockers.length === 0, futureRecurringObligations: expectedOccurrences,
        forecastDays: 90, futureRecurringVisits: affected.length,
        assignedCleaners: new Set(affected.flatMap(v => v.assignments.map(a => a.userId))).size,
        blockers, manualExtraVisits, historicalVisits, effectiveFrom }
      if (preview) return impact
      if (blockers.length) throw new Error('Work is in progress across the end boundary. Resolve it before ending this service.')
      // Keep work before a future end executable even after the rule becomes
      // terminal. Reuse the same pause-aware continuity engine as Schedule.
      for (const job of jobs) {
        for (let from = now; from < effectiveFrom; ) {
          const to = new Date(Math.min(effectiveFrom.getTime(), from.getTime() + 90 * 86_400_000))
          await ensureJobContinuity(tx, job.id, organizationId, from, to)
          from = to
        }
        const changed = await tx.job.updateMany({ where: { id: job.id, status: job.status },
          data: { status: 'completed', endDate: job.endDate && job.endDate < effectiveFrom ? job.endDate : effectiveFrom, version: { increment: 1 } } })
        if (changed.count !== 1) throw new Error('Service changed. Refresh the preview and try again.')
      }
      await cancelVisits(tx, { organizationId, ids: affected.map(v => v.id), reason: `Service ended: ${reason}`, now })
      for (const visit of affected) {
        const userIds = [...new Set(visit.assignments.map(a => a.userId))]
        if (!userIds.length) continue
        const title = 'Recurring visit cancelled'
        const body = `Service ${plan.name} ends from ${effectiveFrom.toISOString()}. Your visit on ${visit.scheduledStart.toISOString()} is cancelled. Reason: ${reason}`
        const notice = await tx.operationalNotice.create({ data: { organizationId, siteId: visit.siteId, visitId: visit.id,
          type: 'schedule_change', priority: 'high', title, body, requiresAcknowledgement: true, createdById: auth.user.id,
          recipients: { create: userIds.map(userId => ({ organizationId, userId })) } } })
        await tx.notificationJob.create({ data: { organizationId, kind: 'operational_notice_push', createdBy: auth.user.email,
          entityType: 'operational_notice', entityId: notice.id, nextAttemptAt: now,
          payload: { userIds, title, body, noticeId: notice.id, priority: 'high' } } })
      }
      await tx.auditLog.create({ data: { organizationId, actorEmail: auth.user.email, action: 'end_client_service',
        targetType: 'service_plan', targetId: plan.id,
        metadata: JSON.stringify({ clientId, reason, effectiveFrom, jobIds: ids, cancelledVisitIds: affected.map(v => v.id), manualExtraVisits }) } })
      return impact
    }, { isolationLevel: 'Serializable', timeout: 30_000 })
    return NextResponse.json({ ok: true, data: result })
  } catch (error) {
    const message = error instanceof Error && !('code' in error) ? error.message : 'Service changed while applying this operation. Refresh the preview and retry.'
    return NextResponse.json({ ok: false, error: message }, { status: 409 })
  }
}