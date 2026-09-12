import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireCapabilities } from '../../../lib/auth'
import { clientCreateSchema, operationalLocationSchema } from '../../../modules/operations/schemas'

const schema = z.object({ client: clientCreateSchema, location: operationalLocationSchema })

export async function POST(request: NextRequest) {
  const auth = await requireCapabilities(request, ['clients.manage', 'sites.manage'])
  if ('response' in auth) return auth.response
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Check the client details and verified location.', details: parsed.error.flatten() }, { status: 400 })
  const { client, location } = parsed.data
  if (client.contacts.filter(contact => contact.isPrimary).length > 1) {
    return NextResponse.json({ ok: false, error: 'Only one primary contact is allowed.' }, { status: 400 })
  }
  try {
    const created = await prisma.$transaction(async tx => {
      const { contacts, ...profile } = client
      const { access, ...address } = location
      const account = await tx.client.create({ data: {
        ...profile, organizationId: auth.user.organizationId,
        contacts: { create: contacts },
        sites: { create: { ...address, countryCode: address.countryCode.toUpperCase(),
          organizationId: auth.user.organizationId,
          access: { create: { entryInstructions: access.entryInstructions } },
          areas: { create: { organizationId: auth.user.organizationId, name: 'Main area', type: 'zone', sortOrder: 0 } },
        } },
      }, include: { contacts: true, sites: true } })
      await tx.auditLog.create({ data: { organizationId: auth.user.organizationId, actorEmail: auth.user.email,
        action: 'create_client_account', targetType: 'client', targetId: account.id,
        metadata: JSON.stringify({ siteId: account.sites[0].id, displayName: account.displayName }),
      } })
      return account
    })
    return NextResponse.json({ ok: true, data: created }, { status: 201 })
  } catch {
    return NextResponse.json({ ok: false, error: 'The client and location could not be saved. No partial account was created. Please retry.' }, { status: 500 })
  }
}