import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../../lib/auth'
import { prisma } from '../../../../../lib/prisma'
import { ensureDefaultMaterialCatalog, materialState } from '../../../../../modules/materials/catalog'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'supplies.request')
  if ('response' in auth) return auth.response
  const { id } = await params
  const site = await prisma.site.findFirst({
    where: { id, organizationId: auth.user.organizationId, archivedAt: null },
    include: { client: true },
  })
  if (!site) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  await ensureDefaultMaterialCatalog(auth.user.organizationId)
  const catalog = await prisma.materialCatalogItem.findMany({
    where: { organizationId: auth.user.organizationId, active: true },
    include: { stockLevels: { where: { siteId: site.id }, take: 1 } },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })
  const data = catalog.map(({ stockLevels, ...item }) => {
    const level = stockLevels[0]
    const onHand = level?.onHand ?? 0
    const parLevel = level?.parLevel ?? item.defaultParLevel
    const reorderPoint = level?.reorderPoint ?? item.defaultReorderPoint
    return {
      ...item,
      onHand,
      parLevel,
      reorderPoint,
      state: materialState({ onHand, parLevel, reorderPoint }),
      estimatedDailyUse: level?.estimatedDailyUse,
      lastCountedAt: level?.lastCountedAt,
    }
  })
  return NextResponse.json({ ok: true, site, data })
}
