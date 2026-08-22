import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { asInputJson } from '../../../../../modules/operations/json'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'service_plans.manage')
  if ('response' in auth) return auth.response
  const { id } = await params

  const plan = await prisma.servicePlan.findFirst({
    where: { id, organizationId: auth.user.organizationId, archivedAt: null },
    include: {
      site: { include: { client: true, access: true, areas: { orderBy: { sortOrder: 'asc' } } } },
      contract: true,
      evidencePolicy: true,
      tasks: { include: { area: true }, where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
    },
  })
  if (!plan) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (!plan.tasks.length) return NextResponse.json({ ok: false, error: 'At least one active task is required' }, { status: 409 })

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
    plan: {
      id: plan.id,
      name: plan.name,
      description: plan.description,
      expectedDurationMinutes: plan.expectedDurationMinutes,
      requiredWorkers: plan.requiredWorkers,
    },
    client: { id: plan.site.client.id, displayName: plan.site.client.displayName },
    contract: plan.contract ? { id: plan.contract.id, name: plan.contract.name, reference: plan.contract.reference } : null,
    site: {
      id: plan.site.id,
      name: plan.site.name,
      addressLine1: plan.site.addressLine1,
      addressLine2: plan.site.addressLine2,
      city: plan.site.city,
      postalCode: plan.site.postalCode,
      timezone: plan.site.timezone,
      latitude: plan.site.latitude?.toString() ?? null,
      longitude: plan.site.longitude?.toString() ?? null,
      geofenceVerifiedM: plan.site.geofenceVerifiedM,
      geofenceNearM: plan.site.geofenceNearM,
      geofenceSuspiciousM: plan.site.geofenceSuspiciousM,
      access: plan.site.access,
    },
    evidencePolicy: plan.evidencePolicy,
    tasks: taskSnapshot,
  }
  const contentHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  const existing = await prisma.servicePlanVersion.findFirst({
    where: { servicePlanId: plan.id, contentHash, organizationId: auth.user.organizationId },
    include: { tasks: { orderBy: { sortOrder: 'asc' } } },
  })
  if (existing) return NextResponse.json({ ok: true, data: existing, idempotent: true })

  const latest = await prisma.servicePlanVersion.aggregate({
    where: { servicePlanId: plan.id },
    _max: { versionNumber: true },
  })
  const versionNumber = (latest._max.versionNumber ?? 0) + 1
  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.servicePlanVersion.create({
      data: {
        organizationId: auth.user.organizationId,
        servicePlanId: plan.id,
        versionNumber,
        expectedDurationMinutes: plan.expectedDurationMinutes,
        requiredWorkers: plan.requiredWorkers,
        snapshot: asInputJson(snapshot)!,
        contentHash,
        publishedBy: auth.user.email,
        tasks: {
          create: taskSnapshot.map((task) => ({
            organizationId: auth.user.organizationId,
            ...task,
            options: asInputJson(task.options),
            conditionalRules: asInputJson(task.conditionalRules),
          })),
        },
      },
      include: { tasks: { orderBy: { sortOrder: 'asc' } } },
    })
    await tx.servicePlan.update({ where: { id: plan.id }, data: { status: 'published' } })
    return created
  })

  await logAudit(auth.user.email, 'publish_service_plan', 'service_plan_version', version.id, {
    servicePlanId: plan.id,
    versionNumber,
    contentHash,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: version }, { status: 201 })
}
