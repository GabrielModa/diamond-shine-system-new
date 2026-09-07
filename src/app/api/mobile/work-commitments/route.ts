import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'
import { acceptedRecurringJobIds, isRecurringAssignmentRule } from '../../../../modules/scheduling/recurring-commitment'

const PENDING_ASSIGNMENT_STATUSES = ['assigned', 'notified', 'seen'] as const

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response

  const now = new Date()
  const horizon = new Date(now.getTime() + 120 * 86_400_000)
  const assignments = await prisma.visitAssignment.findMany({
    where: {
      organizationId: auth.user.organizationId,
      userId: auth.user.id,
      status: { in: [...PENDING_ASSIGNMENT_STATUSES] },
      visit: {
        status: { in: ['scheduled', 'dispatched', 'acknowledged'] },
        scheduledEnd: { gte: now },
        scheduledStart: { lt: horizon },
      },
    },
    include: {
      visit: {
        include: {
          site: { include: { client: { select: { displayName: true } } } },
          job: {
            select: {
              id: true,
              name: true,
              recurrence: true,
              defaultAssignees: { where: { userId: auth.user.id }, select: { userId: true } },
            },
          },
        },
      },
    },
    orderBy: { visit: { scheduledStart: 'asc' } },
  })

  const recurringJobIds = [...new Set(assignments
    .filter((assignment) => isRecurringAssignmentRule(assignment.visit.job.recurrence) && assignment.visit.job.defaultAssignees.length > 0)
    .map((assignment) => assignment.visit.job.id))]
  const acceptedJobIds = await acceptedRecurringJobIds(prisma, {
    organizationId: auth.user.organizationId,
    userId: auth.user.id,
    jobIds: recurringJobIds,
  })

  const grouped = new Map<string, {
    key: string
    scope: 'visit' | 'recurring'
    visitId: string
    jobId: string
    clientName: string
    siteName: string
    jobName: string
    scheduledStart: string
    scheduledEnd: string
    timezone: string
    recurrence: unknown
    occurrences: number
    reason: 'recurring_schedule' | 'visit_change'
  }>()

  for (const assignment of assignments) {
    const { visit } = assignment
    const recurring = isRecurringAssignmentRule(visit.job.recurrence)
      && visit.job.defaultAssignees.length > 0
      && !acceptedJobIds.has(visit.job.id)
    const key = recurring ? `job:${visit.job.id}` : `visit:${visit.id}`
    const existing = grouped.get(key)
    if (existing) {
      existing.occurrences += 1
      continue
    }
    grouped.set(key, {
      key,
      scope: recurring ? 'recurring' : 'visit',
      visitId: visit.id,
      jobId: visit.job.id,
      clientName: visit.site.client.displayName,
      siteName: visit.site.name,
      jobName: visit.job.name,
      scheduledStart: visit.scheduledStart.toISOString(),
      scheduledEnd: visit.scheduledEnd.toISOString(),
      timezone: visit.timezone,
      recurrence: visit.job.recurrence,
      occurrences: 1,
      reason: recurring ? 'recurring_schedule' : 'visit_change',
    })
  }

  return NextResponse.json({ ok: true, data: [...grouped.values()] })
}
