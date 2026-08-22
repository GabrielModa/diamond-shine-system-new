import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { contractCreateSchema } from '../../../modules/operations/schemas'
import { asInputJson } from '../../../modules/operations/json'

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'clients.read')
  if ('response' in auth) return auth.response
  const contracts = await prisma.contract.findMany({
    where: { organizationId: auth.user.organizationId, archivedAt: null },
    orderBy: { createdAt: 'desc' },
    include: {
      client: { select: { id: true, displayName: true } },
      sites: { include: { site: { select: { id: true, name: true, city: true, postalCode: true } } } },
    },
  })
  return NextResponse.json({ ok: true, data: contracts })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'clients.manage')
  if ('response' in auth) return auth.response
  const parsed = contractCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  const client = await prisma.client.findFirst({
    where: { id: parsed.data.clientId, organizationId: auth.user.organizationId, archivedAt: null },
    select: { id: true },
  })
  if (!client) return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 400 })

  const uniqueSiteIds = [...new Set(parsed.data.siteIds)]
  const sites = uniqueSiteIds.length
    ? await prisma.site.findMany({
        where: {
          id: { in: uniqueSiteIds },
          organizationId: auth.user.organizationId,
          clientId: client.id,
          archivedAt: null,
        },
        select: { id: true },
      })
    : []
  if (sites.length !== uniqueSiteIds.length) {
    return NextResponse.json({ ok: false, error: 'Every site must belong to this client and organization.' }, { status: 400 })
  }

  const created = await prisma.contract.create({
    data: {
      organizationId: auth.user.organizationId,
      clientId: client.id,
      name: parsed.data.name,
      reference: parsed.data.reference,
      status: parsed.data.status,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      currency: parsed.data.currency.toUpperCase(),
      completionPolicy: asInputJson(parsed.data.completionPolicy),
      sites: { create: uniqueSiteIds.map((siteId) => ({ siteId })) },
    },
    include: { sites: { include: { site: true } } },
  })
  await logAudit(auth.user.email, 'create_contract', 'contract', created.id, {
    clientId: client.id,
    siteCount: uniqueSiteIds.length,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: created }, { status: 201 })
}
