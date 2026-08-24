import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { prisma } from '../../../../lib/prisma'
import { ensureDefaultMaterialCatalog } from '../../../../modules/materials/catalog'
import { materialCreateSchema } from '../../../../modules/materials/schemas'

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'supplies.request')
  if ('response' in auth) return auth.response
  await ensureDefaultMaterialCatalog(auth.user.organizationId)
  const data = await prisma.materialCatalogItem.findMany({
    where: { organizationId: auth.user.organizationId, active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })
  return NextResponse.json({ ok: true, data })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'supplies.manage')
  if ('response' in auth) return auth.response
  const parsed = materialCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid material', details: parsed.error.flatten() }, { status: 400 })
  const duplicate = await prisma.materialCatalogItem.findFirst({
    where: { organizationId: auth.user.organizationId, OR: [{ sku: parsed.data.sku }, { name: parsed.data.name }] },
  })
  if (duplicate) return NextResponse.json({ ok: false, error: 'A material with this SKU or name already exists.' }, { status: 409 })
  const data = await prisma.materialCatalogItem.create({
    data: { organizationId: auth.user.organizationId, ...parsed.data },
  })
  await logAudit(auth.user.email, 'create_material', 'material_catalog_item', data.id, { sku: data.sku, name: data.name }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data }, { status: 201 })
}
