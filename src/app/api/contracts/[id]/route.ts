import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { contractUpdateSchema } from '../../../../modules/operations/schemas'
import { asInputJson } from '../../../../modules/operations/json'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'clients.read')
  if ('response' in auth) return auth.response
  const { id } = await params
  const contract = await prisma.contract.findFirst({
    where: { id, organizationId: auth.user.organizationId },
    include: { client: true, sites: { include: { site: { include: { access: true, areas: true } } } } },
  })
  if (!contract) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, data: contract })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'clients.manage')
  if ('response' in auth) return auth.response
  const { id } = await params
  const parsed = contractUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  const existing = await prisma.contract.findFirst({
    where: { id, organizationId: auth.user.organizationId, archivedAt: null },
  })
  if (!existing) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (existing.version !== parsed.data.version) {
    return NextResponse.json({ ok: false, error: 'Version conflict' }, { status: 409 })
  }

  const clientId = parsed.data.clientId ?? existing.clientId
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: auth.user.organizationId, archivedAt: null },
    select: { id: true },
  })
  if (!client) return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 400 })

  const siteIds = parsed.data.siteIds ? [...new Set(parsed.data.siteIds)] : null
  if (siteIds) {
    const validSites = await prisma.site.count({
      where: { id: { in: siteIds }, organizationId: auth.user.organizationId, clientId, archivedAt: null },
    })
    if (validSites !== siteIds.length) {
      return NextResponse.json({ ok: false, error: 'Every site must belong to this client and organization.' }, { status: 400 })
    }
  }

  const contract = await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id },
      data: {
        clientId,
        name: parsed.data.name,
        reference: parsed.data.reference,
        status: parsed.data.status,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        currency: parsed.data.currency?.toUpperCase(),
        completionPolicy: asInputJson(parsed.data.completionPolicy),
        version: { increment: 1 },
      },
    })
    if (siteIds) {
      await tx.contractSite.deleteMany({ where: { contractId: id } })
      await tx.contractSite.createMany({ data: siteIds.map((siteId) => ({ contractId: id, siteId })) })
    }
    return tx.contract.findUniqueOrThrow({ where: { id }, include: { sites: { include: { site: true } } } })
  })
  await logAudit(auth.user.email, 'update_contract', 'contract', id, { version: contract.version }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: contract })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'clients.manage')
  if ('response' in auth) return auth.response
  const { id } = await params
  const version = Number(request.nextUrl.searchParams.get('version'))
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ ok: false, error: 'Version is required' }, { status: 400 })
  }
  const result = await prisma.contract.updateMany({
    where: { id, organizationId: auth.user.organizationId, version, archivedAt: null },
    data: { status: 'archived', archivedAt: new Date(), version: { increment: 1 } },
  })
  if (!result.count) return NextResponse.json({ ok: false, error: 'Not found or version conflict' }, { status: 409 })
  await logAudit(auth.user.email, 'archive_contract', 'contract', id, undefined, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { id, archived: true } })
}
