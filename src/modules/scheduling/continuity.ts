import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { generateOccurrences, generationKey } from './recurrence'
import { recurrenceSchema } from './schemas'
import { buildDefaultTeamAllocator } from './default-team'
import { pauseAppliesTo, type PauseWindow } from './service-pause'

export type ContinuityResult = {
  jobsChecked: number
  generatedVisits: number
  pausedOccurrences: number
  staffingGaps: number
}

async function ensureJobContinuity(
  db: Prisma.TransactionClient,
  jobId: string,
  organizationId: string,
  from: Date,
  to: Date,
): Promise<Omit<ContinuityResult, 'jobsChecked'>> {
  const job = await db.job.findFirst({
    where: { id: jobId, organizationId, status: 'active', archivedAt: null },
    include: {
      site: { select: { id: true, clientId: true } },
      defaultAssignees: { orderBy: { priority: 'asc' }, select: { userId: true } },
      visits: {
        where: { scheduledStart: { gte: from, lt: to } },
        select: { generationKey: true },
      },
    },
  })
  if (!job) return { generatedVisits: 0, pausedOccurrences: 0, staffingGaps: 0 }
  const parsedRule = recurrenceSchema.safeParse(job.recurrence ?? { frequency: 'once' })
  if (!parsedRule.success || parsedRule.data.frequency === 'once') return { generatedVisits: 0, pausedOccurrences: 0, staffingGaps: 0 }

  const contractualEnd = job.endDate && job.endDate < to ? job.endDate : to
  if (contractualEnd <= from) return { generatedVisits: 0, pausedOccurrences: 0, staffingGaps: 0 }
  const start = job.startDate > from ? job.startDate : from
  const occurrences = generateOccurrences({
    startAt: job.startDate,
    until: contractualEnd,
    recurrence: parsedRule.data,
    timezone: job.timezone,
    from: start,
    limit: 720,
  }).filter((occurrence) => occurrence >= start && occurrence < contractualEnd)

  const pauses = await db.servicePause.findMany({
    where: {
      organizationId,
      startsAt: { lt: contractualEnd },
      endsAt: { gt: start },
      OR: [
        { scope: 'client', clientId: job.site.clientId },
        { scope: 'site', siteId: job.siteId },
        { scope: 'job', jobId: job.id },
      ],
    },
    select: { id: true, scope: true, clientId: true, siteId: true, jobId: true, startsAt: true, endsAt: true, endedEarlyAt: true },
  }) as PauseWindow[]

  const existingKeys = new Set(job.visits.map((visit) => visit.generationKey))
  const allocator = await buildDefaultTeamAllocator(db, {
    organizationId,
    userIds: job.defaultAssignees.map((item) => item.userId),
    from: start,
    to: contractualEnd,
    timezone: job.timezone,
  })

  let generatedVisits = 0
  let pausedOccurrences = 0
  let staffingGaps = 0
  let sequenceNumber = await db.visit.count({ where: { jobId: job.id } })

  for (const occurrence of occurrences) {
    const key = generationKey(occurrence)
    if (existingKeys.has(key)) continue
    const end = new Date(occurrence.getTime() + job.defaultDurationMin * 60_000)
    const paused = pauses.some((pause) => pauseAppliesTo(pause, {
      clientId: job.site.clientId,
      siteId: job.siteId,
      jobId: job.id,
    }, occurrence, end))
    if (paused) {
      pausedOccurrences += 1
      continue
    }

    const assigneeIds = allocator.select(occurrence, end, job.requiredWorkers)
    sequenceNumber += 1
    try {
      await db.visit.create({
        data: {
          organizationId,
          jobId: job.id,
          siteId: job.siteId,
          servicePlanVersionId: job.servicePlanVersionId,
          scheduledStart: occurrence,
          scheduledEnd: end,
          timezone: job.timezone,
          sequenceNumber,
          generationKey: key,
          requiredWorkers: job.requiredWorkers,
          status: assigneeIds.length ? 'dispatched' : 'scheduled',
          assignments: assigneeIds.length ? {
            create: assigneeIds.map((userId) => ({ organizationId, userId, status: 'assigned' })),
          } : undefined,
        },
      })
      existingKeys.add(key)
      generatedVisits += 1
      if (assigneeIds.length < job.requiredWorkers) staffingGaps += 1
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error
      existingKeys.add(key)
    }
  }

  if (!job.generatedThrough || job.generatedThrough < contractualEnd) {
    await db.job.update({
      where: { id: job.id },
      data: { generatedThrough: contractualEnd, version: { increment: 1 } },
    })
  }
  return { generatedVisits, pausedOccurrences, staffingGaps }
}

export async function ensureScheduleContinuity(input: {
  organizationId: string
  from: Date
  to: Date
  jobIds?: string[]
}): Promise<ContinuityResult> {
  if (input.to <= input.from) throw new RangeError('Continuity range must end after it starts.')
  const jobs = await prisma.job.findMany({
    where: {
      organizationId: input.organizationId,
      status: 'active',
      archivedAt: null,
      ...(input.jobIds?.length ? { id: { in: [...new Set(input.jobIds)] } } : {}),
      startDate: { lt: input.to },
      OR: [{ endDate: null }, { endDate: { gt: input.from } }],
    },
    select: { id: true },
  })

  const total: ContinuityResult = { jobsChecked: jobs.length, generatedVisits: 0, pausedOccurrences: 0, staffingGaps: 0 }
  for (const job of jobs) {
    const result = await prisma.$transaction((tx) => ensureJobContinuity(tx, job.id, input.organizationId, input.from, input.to))
    total.generatedVisits += result.generatedVisits
    total.pausedOccurrences += result.pausedOccurrences
    total.staffingGaps += result.staffingGaps
  }
  return total
}
