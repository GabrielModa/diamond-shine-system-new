import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { enqueueNotification } from '../../../../lib/notification-queue'
import { asInputJson } from '../../../../modules/operations/json'
import { qualityInspectionCreateSchema, qualityInspectionQuerySchema } from '../../../../modules/quality/schemas'
import { calculateQualityScore, correctiveDueAt } from '../../../../modules/quality/scoring'

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'quality.inspect')
  if ('response' in auth) return auth.response
  const parsed = qualityInspectionQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })

  const inspections = await prisma.qualityInspection.findMany({
    where: {
      organizationId: auth.user.organizationId,
      ...(parsed.data.siteId ? { siteId: parsed.data.siteId } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.result ? { passed: parsed.data.result === 'passed' } : {}),
      ...(parsed.data.from || parsed.data.to
        ? { inspectedAt: { ...(parsed.data.from ? { gte: parsed.data.from } : {}), ...(parsed.data.to ? { lte: parsed.data.to } : {}) } }
        : {}),
    },
    include: {
      site: { select: { id: true, name: true, client: { select: { id: true, displayName: true } } } },
      inspector: { select: { id: true, name: true, email: true } },
      visit: { select: { id: true, scheduledStart: true, status: true } },
      items: { orderBy: { sortOrder: 'asc' } },
      actions: { include: { assignedTo: { select: { id: true, name: true, email: true } } }, orderBy: { dueAt: 'asc' } },
    },
    orderBy: { inspectedAt: 'desc' },
    take: 200,
  })

  return NextResponse.json({ ok: true, data: inspections })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'quality.inspect')
  if ('response' in auth) return auth.response
  const parsed = qualityInspectionCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }
  const organizationId = auth.user.organizationId
  const site = await prisma.site.findFirst({
    where: { id: parsed.data.siteId, organizationId, archivedAt: null },
    select: { id: true, name: true, client: { select: { displayName: true } } },
  })
  if (!site) return NextResponse.json({ ok: false, error: 'Site not found' }, { status: 404 })
  if (parsed.data.visitId) {
    const visit = await prisma.visit.findFirst({
      where: { id: parsed.data.visitId, organizationId, siteId: site.id },
      select: { id: true },
    })
    if (!visit) return NextResponse.json({ ok: false, error: 'Visit does not belong to this site' }, { status: 400 })
  }

  const calculated = calculateQualityScore(parsed.data.items)
  const defaultAssignee = await prisma.membership.findFirst({
    where: { organizationId, status: 'active', role: { in: ['field_supervisor', 'organization_admin'] } },
    orderBy: { role: 'asc' },
    select: { userId: true },
  })
  const inspectedAt = parsed.data.inspectedAt ?? new Date()
  const created = await prisma.$transaction(async (tx) => {
    const inspection = await tx.qualityInspection.create({
      data: {
        organizationId,
        siteId: site.id,
        visitId: parsed.data.visitId,
        inspectorId: auth.user.id,
        type: parsed.data.type,
        score: calculated.score,
        grade: calculated.grade,
        passed: calculated.passed,
        summary: parsed.data.summary,
        clientVisible: parsed.data.clientVisible,
        inspectedAt,
        submittedAt: new Date(),
        items: {
          create: parsed.data.items.map((item) => ({
            organizationId,
            category: item.category,
            title: item.title,
            weight: item.weight,
            result: item.result,
            score: item.result === 'fail' ? 0 : 100,
            critical: item.critical,
            finding: item.finding,
            requiredAction: item.requiredAction,
            evidence: asInputJson(item.evidence),
            sortOrder: item.sortOrder,
          })),
        },
      },
      include: { items: true },
    })
    const failedItems = inspection.items.filter((item) => item.result === 'fail')
    if (failedItems.length) {
      await tx.correctiveAction.createMany({
        data: failedItems.map((item) => {
          const severity = item.critical ? 'critical' as const : item.weight >= 3 ? 'major' as const : 'minor' as const
          return {
            organizationId,
            inspectionId: inspection.id,
            inspectionItemId: item.id,
            siteId: site.id,
            visitId: parsed.data.visitId,
            title: `Correct: ${item.title}`,
            description: item.requiredAction ?? item.finding,
            severity,
            assignedToId: defaultAssignee?.userId,
            createdById: auth.user.id,
            dueAt: correctiveDueAt(severity, inspectedAt),
          }
        }),
      })
    }
    return tx.qualityInspection.findUniqueOrThrow({
      where: { id: inspection.id },
      include: { items: { orderBy: { sortOrder: 'asc' } }, actions: { orderBy: { dueAt: 'asc' } } },
    })
  })

  if (!created.passed) {
    await enqueueNotification({
      organizationId,
      kind: 'quality_inspection_failed',
      createdBy: auth.user.email,
      entityType: 'quality_inspection',
      entityId: created.id,
      payload: {
        inspectionId: created.id,
        siteId: site.id,
        siteName: site.name,
        clientName: site.client.displayName,
        score: created.score,
        grade: created.grade,
        correctiveActions: created.actions.length,
      },
    })
  }
  await logAudit(auth.user.email, 'create_quality_inspection', 'quality_inspection', created.id, {
    siteId: site.id,
    score: created.score,
    passed: created.passed,
    correctiveActions: created.actions.length,
  }, organizationId)

  return NextResponse.json({ ok: true, data: created }, { status: 201 })
}
