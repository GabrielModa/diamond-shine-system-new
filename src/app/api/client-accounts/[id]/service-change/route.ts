import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { enqueueNotification } from '../../../../../lib/notification-queue'
import { asInputJson } from '../../../../../modules/operations/json'
import { recurrenceSchema } from '../../../../../modules/scheduling/schemas'
import { generateOccurrences, generationKey } from '../../../../../modules/scheduling/recurrence'
import { buildDefaultTeamAllocator } from '../../../../../modules/scheduling/default-team'

const changeSchema = z.object({
  servicePlanId: z.string().min(1),
  effectiveFrom: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  expectedDurationMinutes: z.number().int().min(1).max(24 * 60),
  requiredWorkers: z.number().int().min(1).max(100),
  tasks: z.array(z.string().trim().min(1).max(240)).min(1).max(1000),
  recurrence: recurrenceSchema,
  instructions: z.string().trim().max(4000).optional().nullable(),
}).refine((value) => !value.endDate || value.endDate >= value.effectiveFrom, {
  message: 'Service end must be on or after the effective date.', path: ['endDate'],
})

const EXECUTABLE_ROLES = ['employee', 'field_supervisor'] as const

function isManualExtraRecurrence(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return (value as { source?: unknown }).source === 'manual_extra'
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const clientAuth = await requireCapability(request, 'clients.manage')
  if ('response' in clientAuth) return clientAuth.response
  const serviceAuth = await requireCapability(request, 'service_plans.manage')
  if ('response' in serviceAuth) return serviceAuth.response
  const scheduleAuth = await requireCapability(request, 'schedule.manage')
  if ('response' in scheduleAuth) return scheduleAuth.response

  const parsed = changeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid service change', details: parsed.error.flatten() }, { status: 400 })
  const { id: clientId } = await params
  const organizationId = clientAuth.user.organizationId
  const now = new Date()
  if (parsed.data.effectiveFrom.getTime() < now.getTime() - 5 * 60_000) {
    return NextResponse.json({ ok: false, error: 'Effective date cannot be in the past.' }, { status: 400 })
  }

  const current = await prisma.servicePlan.findFirst({
    where: { id: parsed.data.servicePlanId, organizationId, archivedAt: null, site: { clientId } },
    include: {
      site: { include: { client: true, access: true, areas: { orderBy: { sortOrder: 'asc' } } } },
      contract: true,
      evidencePolicy: true,
      tasks: { where: { active: true }, orderBy: { sortOrder: 'asc' } },
      jobs: {
        where: { archivedAt: null, status: { in: ['active', 'paused'] } },
        orderBy: { startDate: 'desc' },
        include: { defaultAssignees: { orderBy: { priority: 'asc' } } },
      },
    },
  })
  if (!current) return NextResponse.json({ ok: false, error: 'Service not found for this client.' }, { status: 404 })

  const recurringJobs = current.jobs.filter((job) => !isManualExtraRecurrence(job.recurrence))
  const manualExtraJobs = current.jobs.filter((job) => isManualExtraRecurrence(job.recurrence))
  const latestRuleJob = recurringJobs[0]
  const recurringJobIds = recurringJobs.map((job) => job.id)
  const requestedDefaultAssignees = [...new Set(latestRuleJob?.defaultAssignees.map((item) => item.userId) ?? [])]
  const eligibleMemberships = requestedDefaultAssignees.length ? await prisma.membership.findMany({
    where: {
      organizationId, userId: { in: requestedDefaultAssignees }, status: 'active', role: { in: [...EXECUTABLE_ROLES] }, user: { status: 'active' },
    },
    select: { userId: true },
  }) : []
  const defaultAssigneeIds = eligibleMemberships.map((membership) => membership.userId)
  const sameTasks = current.tasks.length === parsed.data.tasks.length
    && current.tasks.every((task, index) => task.title === parsed.data.tasks[index])

  const initialHorizon = new Date(parsed.data.effectiveFrom.getTime() + 90 * 86_400_000)
  const until = parsed.data.endDate && parsed.data.endDate < initialHorizon ? parsed.data.endDate : initialHorizon
  const occurrences = generateOccurrences({
    startAt: parsed.data.effectiveFrom,
    until,
    recurrence: parsed.data.recurrence,
    timezone: current.site.timezone,
  })
  if (!occurrences.length) return NextResponse.json({ ok: false, error: 'The new recurrence did not generate any future visits.' }, { status: 400 })

  const result = await prisma.$transaction(async (tx) => {
    await tx.servicePlan.update({
      where: { id: current.id },
      data: {
        expectedDurationMinutes: parsed.data.expectedDurationMinutes,
        requiredWorkers: parsed.data.requiredWorkers,
        description: parsed.data.instructions,
        status: 'draft',
        version: { increment: 1 },
      },
    })
    if (!sameTasks) {
      await tx.taskTemplate.deleteMany({ where: { servicePlanId: current.id } })
      await tx.taskTemplate.createMany({
        data: parsed.data.tasks.map((title, sortOrder) => ({
          organizationId, servicePlanId: current.id, title, sortOrder, required: true, responseType: 'done_na_problem',
        })),
      })
    }
    if (current.contract) {
      await tx.contract.update({
        where: { id: current.contract.id },
        data: { endDate: parsed.data.endDate, version: { increment: 1 } },
      })
    }

    const refreshed = await tx.servicePlan.findUniqueOrThrow({
      where: { id: current.id },
      include: {
        site: { include: { client: true, access: true, areas: { orderBy: { sortOrder: 'asc' } } } },
        contract: true,
        evidencePolicy: true,
        tasks: { include: { area: true }, where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
    })
    const taskSnapshot = refreshed.tasks.map((task) => ({
      sourceTaskId: task.id,
      sourceAreaId: task.areaId,
      areaName: task.area?.name ?? null,
      title: task.title,
      instructions: task.instructions,
      responseType: task.responseType,
      critical: task.critical,
      required: task.required,
      evidenceRequired: task.evidenceRequired,
      evidenceVisibility: task.evidenceVisibility,
      options: task.options,
      conditionalRules: task.conditionalRules,
      sortOrder: task.sortOrder,
    }))
    const snapshot = {
      plan: {
        id: refreshed.id, name: refreshed.name, description: refreshed.description,
        expectedDurationMinutes: refreshed.expectedDurationMinutes, requiredWorkers: refreshed.requiredWorkers,
      },
      client: { id: refreshed.site.client.id, displayName: refreshed.site.client.displayName },
      contract: refreshed.contract ? { id: refreshed.contract.id, name: refreshed.contract.name, reference: refreshed.contract.reference } : null,
      site: {
        id: refreshed.site.id, name: refreshed.site.name, addressLine1: refreshed.site.addressLine1, addressLine2: refreshed.site.addressLine2,
        city: refreshed.site.city, postalCode: refreshed.site.postalCode, timezone: refreshed.site.timezone,
        latitude: refreshed.site.latitude?.toString() ?? null, longitude: refreshed.site.longitude?.toString() ?? null,
        geofenceVerifiedM: refreshed.site.geofenceVerifiedM, geofenceNearM: refreshed.site.geofenceNearM,
        geofenceSuspiciousM: refreshed.site.geofenceSuspiciousM, access: refreshed.site.access,
      },
      evidencePolicy: refreshed.evidencePolicy,
      tasks: taskSnapshot,
    }
    const contentHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
    const existingVersion = await tx.servicePlanVersion.findFirst({ where: { organizationId, servicePlanId: refreshed.id, contentHash } })
    const version = existingVersion ?? await (async () => {
      const latest = await tx.servicePlanVersion.aggregate({ where: { servicePlanId: refreshed.id }, _max: { versionNumber: true } })
      return tx.servicePlanVersion.create({
        data: {
          organizationId, servicePlanId: refreshed.id, versionNumber: (latest._max.versionNumber ?? 0) + 1,
          expectedDurationMinutes: refreshed.expectedDurationMinutes, requiredWorkers: refreshed.requiredWorkers,
          snapshot: asInputJson(snapshot)!, contentHash, publishedBy: clientAuth.user.email,
          tasks: { create: taskSnapshot.map((task) => ({
            organizationId, ...task, options: asInputJson(task.options), conditionalRules: asInputJson(task.conditionalRules),
          })) },
        },
      })
    })()
    await tx.servicePlan.update({ where: { id: refreshed.id }, data: { status: 'published' } })

    const replacedVisits = recurringJobIds.length ? await tx.visit.updateMany({
      where: {
        organizationId,
        jobId: { in: recurringJobIds },
        scheduledStart: { gte: parsed.data.effectiveFrom },
        status: { in: ['scheduled', 'dispatched', 'acknowledged'] },
      },
      data: {
        status: 'cancelled', cancelledAt: now,
        cancellationReason: `Service configuration replaced effective ${parsed.data.effectiveFrom.toISOString()}`,
        version: { increment: 1 },
      },
    }) : { count: 0 }
    if (recurringJobIds.length) {
      await tx.job.updateMany({
        where: { organizationId, id: { in: recurringJobIds }, status: { in: ['active', 'paused'] } },
        data: { endDate: parsed.data.effectiveFrom, version: { increment: 1 } },
      })
    }

    const allocationEnd = new Date(Math.max(...occurrences.map((start) => start.getTime() + parsed.data.expectedDurationMinutes * 60_000)))
    const allocator = await buildDefaultTeamAllocator(tx, {
      organizationId, userIds: defaultAssigneeIds, from: occurrences[0], to: allocationEnd, timezone: refreshed.site.timezone,
    })
    const job = await tx.job.create({
      data: {
        organizationId, contractId: refreshed.contractId, siteId: refreshed.siteId, servicePlanId: refreshed.id,
        servicePlanVersionId: version.id, name: `${refreshed.site.client.displayName} · ${refreshed.site.name}`,
        status: 'active', recurrence: asInputJson(parsed.data.recurrence), startDate: parsed.data.effectiveFrom,
        endDate: parsed.data.endDate, generatedThrough: until, defaultDurationMin: parsed.data.expectedDurationMinutes,
        timezone: refreshed.site.timezone, requiredWorkers: parsed.data.requiredWorkers, instructions: parsed.data.instructions,
        defaultAssignees: defaultAssigneeIds.length ? { create: defaultAssigneeIds.map((userId, priority) => ({ organizationId, userId, priority })) } : undefined,
      },
    })
    const assignedUserIds = new Set<string>()
    const visitIds: string[] = []
    for (let index = 0; index < occurrences.length; index += 1) {
      const start = occurrences[index]
      const end = new Date(start.getTime() + parsed.data.expectedDurationMinutes * 60_000)
      const assigneeIds = allocator.select(start, end, parsed.data.requiredWorkers)
      assigneeIds.forEach((userId) => assignedUserIds.add(userId))
      const visit = await tx.visit.create({
        data: {
          organizationId, jobId: job.id, siteId: refreshed.siteId, servicePlanVersionId: version.id,
          scheduledStart: start, scheduledEnd: end, timezone: refreshed.site.timezone,
          sequenceNumber: index + 1, generationKey: generationKey(start), requiredWorkers: parsed.data.requiredWorkers,
          status: assigneeIds.length ? 'dispatched' : 'scheduled',
          assignments: { create: assigneeIds.map((userId) => ({ organizationId, userId, status: 'assigned' })) },
        },
        select: { id: true },
      })
      visitIds.push(visit.id)
    }
    return { version, job, visitIds, assignedUserIds: [...assignedUserIds], replacedVisits: replacedVisits.count }
  })

  if (result.assignedUserIds.length) {
    const first = occurrences[0]
    const notice = await prisma.operationalNotice.create({
      data: {
        organizationId, siteId: current.siteId, visitId: result.visitIds[0], type: 'schedule_change', priority: 'high',
        title: 'Cleaning service schedule updated',
        body: `${current.site.client.displayName} · ${current.site.name} has a new service pattern effective ${first.toLocaleString('en-IE', { timeZone: current.site.timezone })}. Open Schedule for your updated visits.`,
        requiresAcknowledgement: true, createdById: clientAuth.user.id,
        recipients: { create: result.assignedUserIds.map((userId) => ({ organizationId, userId })) },
      },
    })
    await enqueueNotification({
      organizationId, kind: 'operational_notice_push', createdBy: clientAuth.user.email,
      entityType: 'operational_notice', entityId: notice.id,
      payload: { userIds: result.assignedUserIds, title: notice.title, body: notice.body, noticeId: notice.id, priority: notice.priority },
    })
  }

  await logAudit(clientAuth.user.email, 'change_client_service', 'service_plan', current.id, {
    clientId, effectiveFrom: parsed.data.effectiveFrom.toISOString(), serviceVersion: result.version.versionNumber,
    replacedFutureVisits: result.replacedVisits, generatedVisits: result.visitIds.length,
    preservedManualExtraJobs: manualExtraJobs.length,
  }, organizationId)

  return NextResponse.json({ ok: true, data: {
    servicePlanId: current.id,
    versionNumber: result.version.versionNumber,
    replacedFutureVisits: result.replacedVisits,
    generatedVisits: result.visitIds.length,
    preservedManualExtraJobs: manualExtraJobs.length,
    jobId: result.job.id,
  } })
}
