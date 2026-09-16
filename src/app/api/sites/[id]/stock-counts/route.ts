import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { prisma } from '../../../../../lib/prisma'
import { stockCountSchema } from '../../../../../modules/materials/schemas'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'supplies.manage')
  if ('response' in auth) return auth.response

  const parsed = stockCountSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid stock count', details: parsed.error.flatten() }, { status: 400 })
  }

  const { id } = await params
  const site = await prisma.site.findFirst({
    where: { id, organizationId: auth.user.organizationId, archivedAt: null },
    include: { client: true },
  })
  if (!site) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })

  if (parsed.data.visitId) {
    // Stock counting is a supervisor/site-management action, not field Visit
    // execution. A supplies manager may associate the count with any visit at
    // this site without also being personally assigned to that visit.
    const visit = await prisma.visit.findFirst({
      where: {
        id: parsed.data.visitId,
        siteId: site.id,
        organizationId: auth.user.organizationId,
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
      where: {
        organizationId: auth.user.organizationId,
        siteId: site.id,
        catalogItemId: { in: catalog.map((item) => item.id) },
      },
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
      where: {
        organizationId: auth.user.organizationId,
        siteId: site.id,
        catalogItemId: { in: catalog.map((item) => item.id) },
      },
      include: { catalogItem: true },
    })

    // Product rule: a stock count records observed reality only.
    // Procurement remains a separate, intentional action in Supplies.
    return { count, levels, replenishment: null }
  })

  await logAudit(auth.user.email, 'count_site_stock', 'site', site.id, {
    stockCountId: result.count.id,
    visitId: parsed.data.visitId,
    automaticRequestCreation: false,
  }, auth.user.organizationId)

  return NextResponse.json({ ok: true, data: result }, { status: 201 })
}
