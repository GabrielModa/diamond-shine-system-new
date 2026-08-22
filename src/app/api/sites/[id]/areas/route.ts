import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../lib/prisma'
import { requireCapability } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'
import { areaSchema } from '../../../../../modules/operations/schemas'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'sites.manage')
  if ('response' in auth) return auth.response
  const { id: siteId } = await params
  const parsed = areaSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })

  const site = await prisma.site.findFirst({
    where: { id: siteId, organizationId: auth.user.organizationId, archivedAt: null },
    select: { id: true },
  })
  if (!site) return NextResponse.json({ ok: false, error: 'Site not found' }, { status: 404 })
  if (parsed.data.parentId) {
    const parent = await prisma.area.findFirst({
      where: { id: parsed.data.parentId, siteId, organizationId: auth.user.organizationId, active: true },
      select: { id: true },
    })
    if (!parent) return NextResponse.json({ ok: false, error: 'Parent area not found' }, { status: 400 })
  }
  const area = await prisma.area.create({
    data: {
      organizationId: auth.user.organizationId,
      siteId,
      parentId: parsed.data.parentId,
      name: parsed.data.name,
      type: parsed.data.type,
      code: parsed.data.code,
      sortOrder: parsed.data.sortOrder,
    },
  })
  await logAudit(auth.user.email, 'create_area', 'area', area.id, { siteId }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: area }, { status: 201 })
}
