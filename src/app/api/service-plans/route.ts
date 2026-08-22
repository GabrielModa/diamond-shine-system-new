import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { servicePlanCreateSchema } from '../../../modules/operations/schemas'
import { asInputJson } from '../../../modules/operations/json'

async function validatePlanReferences(input: {
  organizationId: string
  siteId: string
  contractId?: string | null
  evidencePolicyId?: string | null
  areaIds: string[]
}) {
  const site = await prisma.site.findFirst({
    where: { id: input.siteId, organizationId: input.organizationId, archivedAt: null },
    select: { id: true, clientId: true },
  })
  if (!site) return { error: 'Site not found' as const }
  if (input.contractId) {
    const contract = await prisma.contract.findFirst({
      where: {
        id: input.contractId,
        organizationId: input.organizationId,
        clientId: site.clientId,
        archivedAt: null,
        sites: { some: { siteId: site.id } },
      },
      select: { id: true },
    })
    if (!contract) return { error: 'Contract must include this site' as const }
  }
  if (input.evidencePolicyId) {
    const policy = await prisma.evidencePolicy.findFirst({
      where: { id: input.evidencePolicyId, organizationId: input.organizationId, archivedAt: null },
      select: { id: true },
    })
    if (!policy) return { error: 'Evidence policy not found' as const }
  }
  const uniqueAreaIds = [...new Set(input.areaIds)]
  if (uniqueAreaIds.length) {
    const count = await prisma.area.count({
      where: { id: { in: uniqueAreaIds }, organizationId: input.organizationId, siteId: site.id, active: true },
    })
    if (count !== uniqueAreaIds.length) return { error: 'Every task area must belong to the selected site' as const }
  }
  return { site }
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'service_plans.read')
  if ('response' in auth) return auth.response
  const plans = await prisma.servicePlan.findMany({
    where: { organizationId: auth.user.organizationId, archivedAt: null },
    orderBy: { updatedAt: 'desc' },
    include: {
      site: { include: { client: { select: { id: true, displayName: true } } } },
      contract: { select: { id: true, name: true, reference: true } },
      evidencePolicy: true,
      _count: { select: { tasks: true, versions: true } },
    },
  })
  return NextResponse.json({ ok: true, data: plans })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'service_plans.manage')
  if ('response' in auth) return auth.response
  const parsed = servicePlanCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }
  const references = await validatePlanReferences({
    organizationId: auth.user.organizationId,
    siteId: parsed.data.siteId,
    contractId: parsed.data.contractId,
    evidencePolicyId: parsed.data.evidencePolicyId,
    areaIds: parsed.data.tasks.flatMap((task) => task.areaId ? [task.areaId] : []),
  })
  if ('error' in references) return NextResponse.json({ ok: false, error: references.error }, { status: 400 })

  const plan = await prisma.servicePlan.create({
    data: {
      organizationId: auth.user.organizationId,
      contractId: parsed.data.contractId,
      siteId: parsed.data.siteId,
      evidencePolicyId: parsed.data.evidencePolicyId,
      name: parsed.data.name,
      description: parsed.data.description,
      expectedDurationMinutes: parsed.data.expectedDurationMinutes,
      requiredWorkers: parsed.data.requiredWorkers,
      tasks: {
        create: parsed.data.tasks.map((task) => ({
          organizationId: auth.user.organizationId,
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
      },
    },
    include: { tasks: { orderBy: { sortOrder: 'asc' } }, site: true },
  })
  await logAudit(auth.user.email, 'create_service_plan', 'service_plan', plan.id, {
    siteId: plan.siteId,
    taskCount: plan.tasks.length,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: plan }, { status: 201 })
}
