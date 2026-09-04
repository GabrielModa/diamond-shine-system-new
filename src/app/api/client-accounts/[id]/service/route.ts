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

const schema = z.object({
  siteId: z.string().min(1),
  serviceName: z.string().trim().min(1).max(200),
  startAt: z.coerce.date(),
  endDate: z.coerce.date().optional().nullable(),
  expectedDurationMinutes: z.number().int().min(1).max(24 * 60),
  requiredWorkers: z.number().int().min(1).max(100),
  tasks: z.array(z.string().trim().min(1).max(240)).min(1).max(1000),
  recurrence: recurrenceSchema,
  instructions: z.string().trim().max(4000).optional().nullable(),
}).refine((value) => !value.endDate || value.endDate >= value.startAt, {
  message: 'Service end must be on or after the start date.', path: ['endDate'],
})

const EXECUTABLE_ROLES = ['employee', 'field_supervisor'] as const

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const clientAuth = await requireCapability(request, 'clients.manage')
  if ('response' in clientAuth) return clientAuth.response
  const serviceAuth = await requireCapability(request, 'service_plans.manage')
  if ('response' in serviceAuth) return serviceAuth.response
  const scheduleAuth = await requireCapability(request, 'schedule.manage')
  if ('response' in scheduleAuth) return scheduleAuth.response

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid service setup', details: parsed.error.flatten() }, { status: 400 })
  const { id: clientId } = await params
  const organizationId = clientAuth.user.organizationId

  const site = await prisma.site.findFirst({
    where: { id: parsed.data.siteId, clientId, organizationId, archivedAt: null },
    include: {
      client: true,
      access: true,
      areas: { orderBy: { sortOrder: 'asc' } },
      preferredAssignees: { orderBy: { priority: 'asc' } },
    },
  })
  if (!site) return NextResponse.json({ ok: false, error: 'Service location not found for this client.' }, { status: 404 })

  const duplicate = await prisma.servicePlan.findFirst({
    where: {
      organizationId, siteId: site.id, archivedAt: null, name: parsed.data.serviceName,
      jobs: { some: { status: 'active', archivedAt: null } },
    },
    select: { id: true },
  })
  if (duplicate) return NextResponse.json({ ok: false, error: 'An active service with this name already exists at this location.' }, { status: 409 })

  const preferredIds = site.preferredAssignees.map((item) => item.userId)
  const eligibleMemberships = preferredIds.length ? await prisma.membership.findMany({
    where: {
      organizationId, userId: { in: preferredIds }, status: 'active', role: { in: [...EXECUTABLE_ROLES] }, user: { status: 'active' },
    },
    select: { userId: true },
  }) : []
  const defaultAssigneeIds = eligibleMemberships.map((membership) => membership.userId)

  const initialHorizon = new Date(parsed.data.startAt.getTime() + 90 * 86_400_000)
  const until = parsed.data.endDate && parsed.data.endDate < initialHorizon ? parsed.data.endDate : initialHorizon
  const occurrences = generateOccurrences({
    startAt: parsed.data.startAt,
    until,
    recurrence: parsed.data.recurrence,
    timezone: site.timezone,
  })
  if (!occurrences.length) return NextResponse.json({ ok: false, error: 'The recurrence did not generate any visits.' }, { status: 400 })

  const result = await prisma.$transaction(async (tx) => {
    const contract = await tx.contract.create({
      data: {
        organizationId, clientId, name: `${site.client.displayName} service agreement`, status: 'active',
        startDate: parsed.data.startAt, endDate: parsed.data.endDate, currency: 'EUR',
        completionPolicy: asInputJson({ checklistRequired: true, blockOnOpenCriticalIncident: true }),
        sites: { create: [{ siteId: site.id }] },
      },
    })
    const plan = await tx.servicePlan.create({
      data: {
        organizationId, contractId: contract.id, siteId: site.id, name: parsed.data.serviceName,
        description: parsed.data.instructions, status: 'draft', expectedDurationMinutes: parsed.data.expectedDurationMinutes,
        requiredWorkers: parsed.data.requiredWorkers,
        tasks: { create: parsed.data.tasks.map((title, sortOrder) => ({
          organizationId, title, sortOrder, required: true, responseType: 'done_na_problem',
        })) },
      },
      include: { tasks: { include: { area: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    })
    const taskSnapshot = plan.tasks.map((task) => ({
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
      plan: { id: plan.id, name: plan.name, description: plan.description, expectedDurationMinutes: plan.expectedDurationMinutes, requiredWorkers: plan.requiredWorkers },
      client: { id: site.client.id, displayName: site.client.displayName },
      contract: { id: contract.id, name: contract.name, reference: contract.reference },
      site: {
        id: site.id, name: site.name, addressLine1: site.addressLine1, addressLine2: site.addressLine2,
        city: site.city, postalCode: site.postalCode, timezone: site.timezone,
        latitude: site.latitude?.toString() ?? null, longitude: site.longitude?.toString() ?? null,
        geofenceVerifiedM: site.geofenceVerifiedM, geofenceNearM: site.geofenceNearM,
        geofenceSuspiciousM: site.geofenceSuspiciousM, access: site.access,
      },
      evidencePolicy: null,
      tasks: taskSnapshot,
    }
    const contentHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
    const version = await tx.servicePlanVersion.create({
      data: {
        organizationId, servicePlanId: plan.id, versionNumber: 1,
        expectedDurationMinutes: plan.expectedDurationMinutes, requiredWorkers: plan.requiredWorkers,
        snapshot: asInputJson(snapshot)!, contentHash, publishedBy: clientAuth.user.email,
        tasks: { create: taskSnapshot.map((task) => ({
          organizationId, ...task, options: asInputJson(task.options), conditionalRules: asInputJson(task.conditionalRules),
        })) },
      },
    })
    await tx.servicePlan.update({ where: { id: plan.id }, data: { status: 'published' } })

    const allocationEnd = new Date(Math.max(...occurrences.map((start) => start.getTime() + parsed.data.expectedDurationMinutes * 60_000)))
    const allocator = await buildDefaultTeamAllocator(tx, {
      organizationId, userIds: defaultAssigneeIds, from: occurrences[0], to: allocationEnd, timezone: site.timezone,
    })
    const job = await tx.job.create({
      data: {
        organizationId, contractId: contract.id, siteId: site.id, servicePlanId: plan.id, servicePlanVersionId: version.id,
        name: `${site.client.displayName} · ${site.name}`, status: 'active', recurrence: asInputJson(parsed.data.recurrence),
        startDate: parsed.data.startAt, endDate: parsed.data.endDate, generatedThrough: until,
        defaultDurationMin: parsed.data.expectedDurationMinutes, timezone: site.timezone,
        requiredWorkers: parsed.data.requiredWorkers, instructions: parsed.data.instructions,
        defaultAssignees: defaultAssigneeIds.length ? { create: defaultAssigneeIds.map((userId, priority) => ({ organizationId, userId, priority })) } : undefined,
      },
    })
    const visitIds: string[] = []
    const assignedUserIds = new Set<string>()
    for (let index = 0; index < occurrences.length; index += 1) {
      const start = occurrences[index]
      const end = new Date(start.getTime() + parsed.data.expectedDurationMinutes * 60_000)
      const assigneeIds = allocator.select(start, end, parsed.data.requiredWorkers)
      assigneeIds.forEach((userId) => assignedUserIds.add(userId))
      const visit = await tx.visit.create({
        data: {
          organizationId, jobId: job.id, siteId: site.id, servicePlanVersionId: version.id,
          scheduledStart: start, scheduledEnd: end, timezone: site.timezone,
          sequenceNumber: index + 1, generationKey: generationKey(start), requiredWorkers: parsed.data.requiredWorkers,
          status: assigneeIds.length ? 'dispatched' : 'scheduled',
          assignments: { create: assigneeIds.map((userId) => ({ organizationId, userId, status: 'assigned' })) },
        },
        select: { id: true },
      })
      visitIds.push(visit.id)
    }
    return { contract, plan, version, job, visitIds, assignedUserIds: [...assignedUserIds] }
  })

  if (result.assignedUserIds.length) {
    const notice = await prisma.operationalNotice.create({
      data: {
        organizationId, siteId: site.id, visitId: result.visitIds[0], type: 'schedule_change', priority: 'high',
        title: 'New cleaning service assigned',
        body: `${site.client.displayName} · ${site.name} has new recurring cleaning work. Open Schedule for your assigned visits.`,
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

  await logAudit(clientAuth.user.email, 'create_client_service', 'service_plan', result.plan.id, {
    clientId, siteId: site.id, contractId: result.contract.id, jobId: result.job.id, generatedVisits: result.visitIds.length,
  }, organizationId)

  return NextResponse.json({ ok: true, data: {
    servicePlanId: result.plan.id, contractId: result.contract.id, jobId: result.job.id,
    versionNumber: result.version.versionNumber, generatedVisits: result.visitIds.length,
  } }, { status: 201 })
}
