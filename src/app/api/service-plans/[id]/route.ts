import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { servicePlanUpdateSchema } from '../../../../modules/operations/schemas'
import { asInputJson } from '../../../../modules/operations/json'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'service_plans.read')
  if ('response' in auth) return auth.response
  const { id } = await params
  const plan = await prisma.servicePlan.findFirst({
    where: { id, organizationId: auth.user.organizationId },
    include: {
      site: { include: { client: true, access: true, areas: { orderBy: { sortOrder: 'asc' } } } },
      contract: true,
      evidencePolicy: true,
      tasks: { include: { area: true }, orderBy: { sortOrder: 'asc' } },
      versions: { orderBy: { versionNumber: 'desc' }, include: { tasks: { orderBy: { sortOrder: 'asc' } } } },
    },
  })
  if (!plan) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, data: plan })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'service_plans.manage')
  if ('response' in auth) return auth.response
  const { id } = await params
  const parsed = servicePlanUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }
  const current = await prisma.servicePlan.findFirst({
    where: { id, organizationId: auth.user.organizationId, archivedAt: null },
  })
  if (!current) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (current.version !== parsed.data.version) {
    return NextResponse.json({ ok: false, error: 'Version conflict' }, { status: 409 })
  }
  const siteId = parsed.data.siteId ?? current.siteId
  const areaIds = parsed.data.tasks?.flatMap((task) => task.areaId ? [task.areaId] : []) ?? []
  const site = await prisma.site.findFirst({
    where: { id: siteId, organizationId: auth.user.organizationId, archivedAt: null },
    select: { id: true, clientId: true },
  })
  if (!site) return NextResponse.json({ ok: false, error: 'Site not found' }, { status: 400 })
  if (areaIds.length) {
    const count = await prisma.area.count({
      where: { id: { in: [...new Set(areaIds)] }, siteId, organizationId: auth.user.organizationId, active: true },
    })
    if (count !== new Set(areaIds).size) {
      return NextResponse.json({ ok: false, error: 'Every task area must belong to the selected site' }, { status: 400 })
    }
  }

  const plan = await prisma.$transaction(async (tx) => {
    await tx.servicePlan.update({
      where: { id },
      data: {
        contractId: parsed.data.contractId,
        siteId: parsed.data.siteId,
        evidencePolicyId: parsed.data.evidencePolicyId,
        name: parsed.data.name,
        description: parsed.data.description,
        expectedDurationMinutes: parsed.data.expectedDurationMinutes,
        requiredWorkers: parsed.data.requiredWorkers,
        status: 'draft',
        version: { increment: 1 },
      },
    })
    if (parsed.data.tasks) {
      await tx.taskTemplate.deleteMany({ where: { servicePlanId: id } })
      await tx.taskTemplate.createMany({
        data: parsed.data.tasks.map((task) => ({
          organizationId: auth.user.organizationId,
          servicePlanId: id,
          areaId: task.areaId,
          title: task.title,
          instructions: task.instructions,
          responseType: task.responseType,
          critical: task.critical,
          required: task.required,
          evidenceRequired: task.evidenceRequired,
          evidenceVisibility: task.evidenceVisibility,
          options: asInputJson(task.options),
          conditionalRules: asInputJson(task.conditionalRules),
          sortOrder: task.sortOrder,
        })),
      })
    }
    return tx.servicePlan.findUniqueOrThrow({
      where: { id },
      include: { tasks: { include: { area: true }, orderBy: { sortOrder: 'asc' } } },
    })
  })
  await logAudit(auth.user.email, 'update_service_plan', 'service_plan', id, {
    version: plan.version,
    taskCount: plan.tasks.length,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: plan })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'service_plans.manage')
  if ('response' in auth) return auth.response
  const { id } = await params
  const version = Number(request.nextUrl.searchParams.get('version'))
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ ok: false, error: 'Version is required' }, { status: 400 })
  }
  const result = await prisma.servicePlan.updateMany({
    where: { id, organizationId: auth.user.organizationId, version, archivedAt: null },
    data: { status: 'archived', archivedAt: new Date(), version: { increment: 1 } },
  })
  if (!result.count) return NextResponse.json({ ok: false, error: 'Not found or version conflict' }, { status: 409 })
  await logAudit(auth.user.email, 'archive_service_plan', 'service_plan', id, undefined, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { id, archived: true } })
}
