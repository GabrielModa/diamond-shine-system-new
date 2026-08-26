import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { clientCreateSchema } from '../../../modules/operations/schemas'

const querySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['draft', 'active', 'paused', 'ended', 'archived']).optional(),
})

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'clients.read')
  if ('response' in auth) return auth.response
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  const search = parsed.data.search?.trim()
  const clients = await prisma.client.findMany({
    where: {
      organizationId: auth.user.organizationId,
      ...(parsed.data.status ? { status: parsed.data.status } : { archivedAt: null }),
      ...(search ? {
        OR: [
          { displayName: { contains: search, mode: 'insensitive' } },
          { legalName: { contains: search, mode: 'insensitive' } },
          { externalId: { contains: search, mode: 'insensitive' } },
          { billingEmail: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { contacts: { some: { OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search, mode: 'insensitive' } },
          ] } } },
          { sites: { some: { OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { city: { contains: search, mode: 'insensitive' } },
            { postalCode: { contains: search, mode: 'insensitive' } },
            { addressLine1: { contains: search, mode: 'insensitive' } },
          ] } } },
        ],
      } : {}),
    },
    orderBy: { displayName: 'asc' },
    include: {
      contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
      _count: { select: { sites: true, contracts: true } },
    },
  })
  return NextResponse.json({ ok: true, data: clients })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'clients.manage')
  if ('response' in auth) return auth.response
  const parsed = clientCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  const primaryContacts = parsed.data.contacts.filter((contact) => contact.isPrimary)
  if (primaryContacts.length > 1) return NextResponse.json({ ok: false, error: 'Only one primary contact is allowed.' }, { status: 400 })
  const created = await prisma.client.create({
    data: {
      organizationId: auth.user.organizationId,
      displayName: parsed.data.displayName,
      legalName: parsed.data.legalName,
      type: parsed.data.type,
      billingEmail: parsed.data.billingEmail,
      phone: parsed.data.phone,
      externalId: parsed.data.externalId,
      contacts: { create: parsed.data.contacts },
    },
    include: { contacts: true },
  })
  await logAudit(auth.user.email, 'create_client', 'client', created.id, { displayName: created.displayName }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: created }, { status: 201 })
}
