import { prisma } from '../../lib/prisma'
import { ACTIVE_ASSIGNMENT_STATUSES, NON_OPERATIONAL_VISIT_STATUSES } from './assignment-lifecycle'
import { generateOccurrences, generationKey } from './recurrence'
import { recurrenceSchema } from './schemas'
import { pauseAppliesTo, type PauseWindow } from './service-pause'
import {
  coverageState,
  intervalsOverlap,
  sortScheduleHealthItems,
  type ScheduleHealthItem,
  type ScheduleHealthSummary,
} from './schedule-health-core'

export type ScheduleHealthResult = {
  from: string
  to: string
  generatedAt: string
  summary: ScheduleHealthSummary
  items: ScheduleHealthItem[]
}

function workerName(user: { name: string | null; email: string }) {
  return user.name ?? user.email
}

export async function buildScheduleHealth(input: {
  organizationId: string
  from: Date
  to: Date
}): Promise<ScheduleHealthResult> {
  if (input.to <= input.from) throw new RangeError('Health range must end after it starts.')

  const [plans, jobs, visits, pauses, existingVisits] = await Promise.all([
    prisma.servicePlan.findMany({
      where: {
        organizationId: input.organizationId,
        status: 'published',
        archivedAt: null,
        site: { archivedAt: null },
      },
      include: {
        site: { select: { id: true, name: true, timezone: true, client: { select: { id: true, displayName: true } } } },
        jobs: {
          where: { archivedAt: null, status: { in: ['active', 'paused'] } },
          select: { id: true },
        },
      },
    }),
    prisma.job.findMany({
      where: {
        organizationId: input.organizationId,
        archivedAt: null,
        status: { in: ['active', 'paused'] },
        startDate: { lt: input.to },
        OR: [{ endDate: null }, { endDate: { gt: input.from } }],
      },
      include: {
        site: { select: { id: true, name: true, client: { select: { id: true, displayName: true } } } },
        servicePlan: { select: { id: true, name: true } },
      },
    }),
    prisma.visit.findMany({
      where: {
        organizationId: input.organizationId,
        scheduledStart: { gte: input.from, lt: input.to },
        status: { notIn: [...NON_OPERATIONAL_VISIT_STATUSES] },
      },
      orderBy: { scheduledStart: 'asc' },
      include: {
        site: { select: { id: true, name: true, client: { select: { id: true, displayName: true } } } },
        job: { select: { id: true, name: true, servicePlanId: true } },
        assignments: {
          where: { status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    }),
    prisma.servicePause.findMany({
      where: {
        organizationId: input.organizationId,
        startsAt: { lt: input.to },
        endsAt: { gt: input.from },
      },
      select: { id: true, scope: true, clientId: true, siteId: true, jobId: true, startsAt: true, endsAt: true, endedEarlyAt: true, version: true },
    }),
    prisma.visit.findMany({
      where: { organizationId: input.organizationId, generationKey: { gte: input.from.toISOString(), lt: input.to.toISOString() } },
      select: { id: true, jobId: true, generationKey: true, scheduledStart: true, scheduledEnd: true, status: true, servicePauseId: true, servicePause: { select: { id: true, endedEarlyAt: true, version: true } } },
    }),
  ])

  const items: ScheduleHealthItem[] = []
  const summary: ScheduleHealthSummary = {
    visits: visits.length,
    covered: 0,
    needsStaff: 0,
    unassigned: 0,
    missingSchedule: 0,
    unscheduledServices: 0,
    paused: 0,
    conflicts: 0,
    unacknowledged: 0,
    attention: 0,
  }

  for (const plan of plans) {
    if (plan.jobs.length) continue
    summary.unscheduledServices += 1
    items.push({
      id: `plan:${plan.id}:unscheduled`,
      state: 'unscheduled_service',
      clientId: plan.site.client.id,
      clientName: plan.site.client.displayName,
      siteId: plan.site.id,
      siteName: plan.site.name,
      servicePlanId: plan.id,
      servicePlanName: plan.name,
      timezone: plan.site.timezone,
      detail: 'This service is published but does not have a working schedule yet.',
    })
  }

  for (const visit of visits) {
    const activeWorkers = visit.assignments.length
    const state = coverageState(activeWorkers, visit.requiredWorkers)
    if (state === 'covered') summary.covered += 1
    if (state === 'needs_staff') summary.needsStaff += 1
    if (state === 'unassigned') summary.unassigned += 1
    items.push({
      id: `visit:${visit.id}:coverage`,
      state,
      scheduledStart: visit.scheduledStart.toISOString(),
      scheduledEnd: visit.scheduledEnd.toISOString(),
      timezone: visit.timezone,
      clientId: visit.site.client.id,
      clientName: visit.site.client.displayName,
      siteId: visit.site.id,
      siteName: visit.site.name,
      servicePlanId: visit.job.servicePlanId,
      jobId: visit.job.id,
      jobName: visit.job.name,
      visitId: visit.id,
      requiredWorkers: visit.requiredWorkers,
      activeWorkers,
      workerNames: visit.assignments.map((assignment) => workerName(assignment.user)),
      detail: state === 'covered'
        ? `${activeWorkers}/${visit.requiredWorkers} cleaners ready.`
        : state === 'unassigned'
          ? `No cleaners assigned yet · needs ${visit.requiredWorkers}.`
          : `${activeWorkers}/${visit.requiredWorkers} cleaners assigned · ${visit.requiredWorkers - activeWorkers} still needed.`,
    })

    if (visit.assignments.length && visit.assignments.some((assignment) => assignment.status !== 'acknowledged')) {
      summary.unacknowledged += 1
      items.push({
        id: `visit:${visit.id}:ack`,
        state: 'acknowledgement_pending',
        scheduledStart: visit.scheduledStart.toISOString(),
        scheduledEnd: visit.scheduledEnd.toISOString(),
        timezone: visit.timezone,
        clientId: visit.site.client.id,
        clientName: visit.site.client.displayName,
        siteId: visit.site.id,
        siteName: visit.site.name,
        servicePlanId: visit.job.servicePlanId,
        jobId: visit.job.id,
        jobName: visit.job.name,
        visitId: visit.id,
        requiredWorkers: visit.requiredWorkers,
        activeWorkers,
        workerNames: visit.assignments.filter((assignment) => assignment.status !== 'acknowledged').map((assignment) => workerName(assignment.user)),
        detail: 'One or more assigned cleaners have not confirmed this visit in the app.',
      })
    }
  }

  const assignmentWindows = new Map<string, Array<{ visit: (typeof visits)[number]; user: (typeof visits)[number]['assignments'][number]['user'] }>>()
  for (const visit of visits) {
    for (const assignment of visit.assignments) {
      const list = assignmentWindows.get(assignment.user.id) ?? []
      list.push({ visit, user: assignment.user })
      assignmentWindows.set(assignment.user.id, list)
    }
  }
  const conflictKeys = new Set<string>()
  const conflictingVisitIds = new Set<string>()
  for (const [userId, windows] of assignmentWindows) {
    const sorted = [...windows].sort((a, b) => a.visit.scheduledStart.getTime() - b.visit.scheduledStart.getTime())
    for (let left = 0; left < sorted.length; left += 1) {
      for (let right = left + 1; right < sorted.length; right += 1) {
        const a = sorted[left]
        const b = sorted[right]
        if (b.visit.scheduledStart >= a.visit.scheduledEnd) break
        if (!intervalsOverlap(a.visit.scheduledStart, a.visit.scheduledEnd, b.visit.scheduledStart, b.visit.scheduledEnd)) continue
        const key = [userId, a.visit.id, b.visit.id].sort().join(':')
        if (conflictKeys.has(key)) continue
        conflictKeys.add(key)
        conflictingVisitIds.add(a.visit.id)
        conflictingVisitIds.add(b.visit.id)
        const overlapMinutes = Math.max(1, Math.round((Math.min(a.visit.scheduledEnd.getTime(), b.visit.scheduledEnd.getTime()) - Math.max(a.visit.scheduledStart.getTime(), b.visit.scheduledStart.getTime())) / 60_000))
        const name = workerName(b.user)
        items.push({
          id: `overlap:${key}`,
          state: 'cleaner_overlap',
          scheduledStart: b.visit.scheduledStart.toISOString(),
          scheduledEnd: b.visit.scheduledEnd.toISOString(),
          timezone: b.visit.timezone,
          clientId: b.visit.site.client.id,
          clientName: b.visit.site.client.displayName,
          siteId: b.visit.site.id,
          siteName: b.visit.site.name,
          jobId: b.visit.job.id,
          jobName: b.visit.job.name,
          visitId: b.visit.id,
          workerNames: [name],
          conflict: {
            workerId: userId,
            workerName: name,
            otherVisitId: a.visit.id,
            otherClientName: a.visit.site.client.displayName,
            otherSiteName: a.visit.site.name,
            otherJobName: a.visit.job.name,
            otherScheduledStart: a.visit.scheduledStart.toISOString(),
            otherScheduledEnd: a.visit.scheduledEnd.toISOString(),
            otherTimezone: a.visit.timezone,
            overlapMinutes,
          },
          detail: `${name} is assigned to two visits at the same time.`,
        })
      }
    }
  }
  summary.conflicts = conflictingVisitIds.size

  const pauseWindows = pauses as PauseWindow[]
  const keysByJob = new Map<string, Set<string>>()
  const earlyEndedByJob = new Map<string, Map<string, (typeof existingVisits)[number]>>()
  for (const visit of existingVisits) {
    const cancelledByPause = visit.status === 'cancelled' && Boolean(visit.servicePauseId)
    const endedEarlyBeforeVisit = cancelledByPause && visit.servicePause?.endedEarlyAt && visit.servicePause.endedEarlyAt < visit.scheduledStart
    if (endedEarlyBeforeVisit) {
      const byKey = earlyEndedByJob.get(visit.jobId) ?? new Map<string, (typeof existingVisits)[number]>()
      byKey.set(visit.generationKey, visit); earlyEndedByJob.set(visit.jobId, byKey)
      continue
    }
    if (cancelledByPause) continue
    const set = keysByJob.get(visit.jobId) ?? new Set<string>()
    set.add(visit.generationKey); keysByJob.set(visit.jobId, set)
  }

  for (const job of jobs) {
    const parsed = recurrenceSchema.safeParse(job.recurrence ?? { frequency: 'once' })
    if (!parsed.success) continue
    const contractualEnd = job.endDate && job.endDate < input.to ? job.endDate : input.to
    if (contractualEnd <= input.from) continue
    const occurrences = generateOccurrences({
      startAt: job.startDate,
      until: contractualEnd,
      recurrence: parsed.data,
      timezone: job.timezone,
      from: input.from,
      limit: 720,
    }).filter((occurrence) => occurrence >= input.from && occurrence < contractualEnd)
    if (!occurrences.length) continue
    const existingKeys = keysByJob.get(job.id) ?? new Set<string>()
    const earlyEndedKeys = earlyEndedByJob.get(job.id) ?? new Map<string, (typeof existingVisits)[number]>()
    for (const occurrence of occurrences) {
      const key = generationKey(occurrence)
      if (existingKeys.has(key)) continue
      const earlyEndedVisit = earlyEndedKeys.get(key)
      if (earlyEndedVisit) {
        summary.missingSchedule += 1
        items.push({
          id: `expected:${job.id}:${key}:ended-pause-review`,
          state: 'expected_not_scheduled',
          scheduledStart: occurrence.toISOString(),
          scheduledEnd: earlyEndedVisit.scheduledEnd.toISOString(),
          timezone: job.timezone,
          clientId: job.site.client.id,
          clientName: job.site.client.displayName,
          siteId: job.site.id,
          siteName: job.site.name,
          servicePlanId: job.servicePlan.id,
          servicePlanName: job.servicePlan.name,
          jobId: job.id,
          jobName: job.name,
          visitId: earlyEndedVisit.id,
          pauseId: earlyEndedVisit.servicePause?.id ?? null,
          pauseVersion: earlyEndedVisit.servicePause?.version ?? null,
          requiredWorkers: job.requiredWorkers,
          activeWorkers: 0,
          detail: 'Service resumed early. Review this cancelled visit before putting it back on the schedule.',
        })
        continue
      }
      const end = new Date(occurrence.getTime() + job.defaultDurationMin * 60_000)
      const explicitPause = pauseWindows.find((pause) => pauseAppliesTo(pause, {
        clientId: job.site.client.id,
        siteId: job.site.id,
        jobId: job.id,
      }, occurrence, end))
      if (job.status === 'paused' || explicitPause) {
        summary.paused += 1
        items.push({
          id: `expected:${job.id}:${key}:paused`,
          state: 'service_paused',
          scheduledStart: occurrence.toISOString(),
          scheduledEnd: end.toISOString(),
          timezone: job.timezone,
          clientId: job.site.client.id,
          clientName: job.site.client.displayName,
          siteId: job.site.id,
          siteName: job.site.name,
          servicePlanId: job.servicePlan.id,
          servicePlanName: job.servicePlan.name,
          jobId: job.id,
          jobName: job.name,
          pauseId: explicitPause?.id ?? null,
          pauseVersion: explicitPause?.version ?? null,
          requiredWorkers: job.requiredWorkers,
          activeWorkers: 0,
          detail: explicitPause ? 'Recurring obligation is intentionally covered by a service pause.' : 'Recurring job is paused.',
        })
      } else {
        summary.missingSchedule += 1
        items.push({
          id: `expected:${job.id}:${key}:missing`,
          state: 'expected_not_scheduled',
          scheduledStart: occurrence.toISOString(),
          scheduledEnd: end.toISOString(),
          timezone: job.timezone,
          clientId: job.site.client.id,
          clientName: job.site.client.displayName,
          siteId: job.site.id,
          siteName: job.site.name,
          servicePlanId: job.servicePlan.id,
          servicePlanName: job.servicePlan.name,
          jobId: job.id,
          jobName: job.name,
          requiredWorkers: job.requiredWorkers,
          activeWorkers: 0,
          detail: 'This recurring service should have a visit here, but it has not been created yet.',
        })
      }
    }
  }

  summary.attention =
    summary.needsStaff
    + summary.unassigned
    + summary.missingSchedule
    + summary.unscheduledServices
    + summary.conflicts
    + summary.unacknowledged

  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    generatedAt: new Date().toISOString(),
    summary,
    items: items.sort(sortScheduleHealthItems),
  }
}
