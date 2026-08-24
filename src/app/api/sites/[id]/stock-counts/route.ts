import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { prisma } from '../../../../../lib/prisma'
import { enqueueNotification } from '../../../../../lib/notification-queue'
import { calculateSupplyDueAt } from '../../../../../lib/business-logic'
import { assignedVisitFilter } from '../../../../../modules/execution/access'
import { stockCountSchema } from '../../../../../modules/materials/schemas'
import { asInputJson } from '../../../../../modules/operations/json'

const ACTIVE_REQUEST_STATUSES = ['Requested', 'Triaged', 'Approved', 'Ordered', 'InTransit']

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'supplies.request')
  if ('response' in auth) return auth.response
  const parsed = stockCountSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid stock count', details: parsed.error.flatten() }, { status: 400 })
  const { id } = await params
  const site = await prisma.site.findFirst({
    where: { id, organizationId: auth.user.organizationId, archivedAt: null },
    include: { client: true },
  })
  if (!site) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })

  if (parsed.data.visitId) {
    const visit = await prisma.visit.findFirst({
      where: {
        id: parsed.data.visitId,
        siteId: site.id,
        organizationId: auth.user.organizationId,
        ...assignedVisitFilter(auth.user),
      },
    })
    if (!visit) return NextResponse.json({ ok: false, error: 'Visit not found' }, { status: 404 })
  }

  const catalog = await prisma.materialCatalogItem.findMany({
    where: {
      organizationId: auth.user.organizationId,
      active: true,
      id: { in: parsed.data.lines.map((line) => line.catalogItemId) },
    },
  })
  if (catalog.length !== parsed.data.lines.length) {
    return NextResponse.json({ ok: false, error: 'One or more materials are unavailable.' }, { status: 400 })
  }
  const catalogById = new Map(catalog.map((item) => [item.id, item]))

  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.siteStockLevel.findMany({
      where: { organizationId: auth.user.organizationId, siteId: site.id, catalogItemId: { in: catalog.map((item) => item.id) } },
    })
    const previousByItem = new Map(previous.map((level) => [level.catalogItemId, level]))
    const count = await tx.materialStockCount.create({
      data: {
        organizationId: auth.user.organizationId,
        siteId: site.id,
        visitId: parsed.data.visitId,
        countedBy: auth.user.id,
        source: parsed.data.source,
        note: parsed.data.note,
        lines: {
          create: parsed.data.lines.map((line) => ({
            organizationId: auth.user.organizationId,
            catalogItemId: line.catalogItemId,
            previousQuantity: previousByItem.get(line.catalogItemId)?.onHand,
            quantity: line.quantity,
            note: line.note,
          })),
        },
      },
      include: { lines: { include: { catalogItem: true } } },
    })
    for (const line of parsed.data.lines) {
      const item = catalogById.get(line.catalogItemId)!
      await tx.siteStockLevel.upsert({
        where: { siteId_catalogItemId: { siteId: site.id, catalogItemId: item.id } },
        update: {
          onHand: line.quantity,
          lastCountedAt: count.createdAt,
          lastCountedBy: auth.user.id,
          version: { increment: 1 },
        },
        create: {
          organizationId: auth.user.organizationId,
          siteId: site.id,
          catalogItemId: item.id,
          onHand: line.quantity,
          parLevel: item.defaultParLevel,
          reorderPoint: item.defaultReorderPoint,
          lastCountedAt: count.createdAt,
          lastCountedBy: auth.user.id,
        },
      })
    }

    const levels = await tx.siteStockLevel.findMany({
      where: { organizationId: auth.user.organizationId, siteId: site.id, catalogItemId: { in: catalog.map((item) => item.id) } },
      include: { catalogItem: true },
    })
    const shortages = levels.filter((level) => level.onHand <= level.reorderPoint)
    const openRequests = shortages.length ? await tx.supplyRequest.findMany({
      where: { organizationId: auth.user.organizationId, siteId: site.id, status: { in: ACTIVE_REQUEST_STATUSES } },
      include: { items: true },
    }) : []
    const pendingCatalogIds = new Set(openRequests.flatMap((open) => open.items.map((item) => item.catalogItemId).filter(Boolean)))
    const unrequested = shortages.filter((level) => !pendingCatalogIds.has(level.catalogItemId))
    const priority = unrequested.some((level) => level.onHand === 0) ? 'urgent' as const : 'normal' as const
    const replenishment = unrequested.length ? await tx.supplyRequest.create({
      data: {
        organizationId: auth.user.organizationId,
        employeeName: auth.user.name ?? auth.user.email,
        clientLocation: site.name,
        priority,
        products: JSON.stringify(unrequested.map((level) => level.catalogItem.name)),
        notes: `Automatically created from stock count ${count.id}.`,
        submittedBy: auth.user.email,
        status: 'Requested',
        dueAt: calculateSupplyDueAt(priority),
        siteId: site.id,
        visitId: parsed.data.visitId,
        source: 'stock_count',
        items: {
          create: unrequested.map((level) => ({
            catalogItemId: level.catalogItemId,
            product: level.catalogItem.name,
            quantity: Math.max(1, level.parLevel - level.onHand),
            currentQuantity: level.onHand,
            targetQuantity: level.parLevel,
          })),
        },
        statusEvents: { create: { toStatus: 'Requested', actorEmail: auth.user.email, note: 'Automatically generated from stock shortage' } },
      },
      include: { items: true },
    }) : null
    return { count, levels, replenishment }
  })

  if (result.replenishment) {
    await enqueueNotification({
      organizationId: auth.user.organizationId,
      kind: 'supply_alert',
      createdBy: auth.user.email,
      entityType: 'supply',
      entityId: result.replenishment.id,
      payload: asInputJson({
        id: result.replenishment.id,
        employeeName: result.replenishment.employeeName,
        clientLocation: result.replenishment.clientLocation,
        priority: result.replenishment.priority,
        products: result.replenishment.items.map((item) => item.product),
        items: result.replenishment.items,
        submittedBy: result.replenishment.submittedBy,
        createdAt: result.replenishment.createdAt.toISOString(),
      })!,
    })
  }
  await logAudit(auth.user.email, 'count_site_stock', 'site', site.id, {
    stockCountId: result.count.id,
    visitId: parsed.data.visitId,
    generatedRequestId: result.replenishment?.id,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: result }, { status: 201 })
}
