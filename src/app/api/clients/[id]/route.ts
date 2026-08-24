import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { clientUpdateSchema } from '../../../../modules/operations/schemas'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'clients.read')
  if ('response' in auth) return auth.response
  const { id } = await params

  const client = await prisma.client.findFirst({
    where: { id, organizationId: auth.user.organizationId },
    include: {
      contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
      contracts: { where: { archivedAt: null }, orderBy: { createdAt: 'desc' } },
      sites: { where: { archivedAt: null }, orderBy: { name: 'asc' } },
    },
  })
  if (!client) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, data: client })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'clients.manage')
  if ('response' in auth) return auth.response
  const { id } = await params
  const parsed = clientUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  const { version, ...changes } = parsed.data
  const updated = await prisma.client.updateMany({
    where: { id, organizationId: auth.user.organizationId, version, archivedAt: null },
    data: { ...changes, version: { increment: 1 } },
  })
  if (!updated.count) {
    const exists = await prisma.client.count({ where: { id, organizationId: auth.user.organizationId } })
    return NextResponse.json(
      { ok: false, error: exists ? 'Version conflict' : 'Not found' },
      { status: exists ? 409 : 404 }
    )
  }

  const client = await prisma.client.findUniqueOrThrow({ where: { id } })
  await logAudit(auth.user.email, 'update_client', 'client', id, { version: client.version }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: client })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'clients.manage')
  if ('response' in auth) return auth.response
  const { id } = await params
  const parsed = z.coerce.number().int().min(1).safeParse(request.nextUrl.searchParams.get('version'))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Version is required' }, { status: 400 })

  const updated = await prisma.client.updateMany({
    where: { id, organizationId: auth.user.organizationId, version: parsed.data, archivedAt: null },
    data: { status: 'archived', archivedAt: new Date(), version: { increment: 1 } },
  })
  if (!updated.count) return NextResponse.json({ ok: false, error: 'Not found or version conflict' }, { status: 409 })
  await logAudit(auth.user.email, 'archive_client', 'client', id, undefined, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { id, archived: true } })
}
