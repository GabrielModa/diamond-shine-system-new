import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'
import { logAudit } from '../../../lib/audit'
import { siteCreateSchema } from '../../../modules/operations/schemas'
import { asInputJson } from '../../../modules/operations/json'

const querySchema = z.object({ clientId: z.string().optional(), search: z.string().trim().optional() })

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'sites.read')
  if ('response' in auth) return auth.response
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })

  const sites = await prisma.site.findMany({
    where: {
      organizationId: auth.user.organizationId,
      archivedAt: null,
      ...(parsed.data.clientId ? { clientId: parsed.data.clientId } : {}),
      ...(parsed.data.search
        ? {
            OR: [
              { name: { contains: parsed.data.search, mode: 'insensitive' as const } },
              { city: { contains: parsed.data.search, mode: 'insensitive' as const } },
              { postalCode: { contains: parsed.data.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ client: { displayName: 'asc' } }, { name: 'asc' }],
    include: {
      client: { select: { id: true, displayName: true } },
      access: true,
      _count: { select: { areas: true, servicePlans: true } },
    },
  })
  return NextResponse.json({ ok: true, data: sites })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'sites.manage')
  if ('response' in auth) return auth.response
  const parsed = siteCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }
  if (parsed.data.areas.some((area) => area.parentId)) {
    return NextResponse.json({ ok: false, error: 'Create parent areas first, then add nested areas.' }, { status: 400 })
  }

  const client = await prisma.client.findFirst({
    where: { id: parsed.data.clientId, organizationId: auth.user.organizationId, archivedAt: null },
    select: { id: true },
  })
  if (!client) return NextResponse.json({ ok: false, error: 'Client not found' }, { status: 400 })

  const contractIds = [...new Set(parsed.data.contractIds)]
  if (contractIds.length) {
    const count = await prisma.contract.count({
      where: {
        id: { in: contractIds },
        organizationId: auth.user.organizationId,
        clientId: client.id,
        archivedAt: null,
      },
    })
    if (count !== contractIds.length) {
      return NextResponse.json({ ok: false, error: 'Every contract must belong to this client and organization.' }, { status: 400 })
    }
  }

  const access = parsed.data.access
  const created = await prisma.site.create({
    data: {
      organizationId: auth.user.organizationId,
      clientId: client.id,
      name: parsed.data.name,
      addressLine1: parsed.data.addressLine1,
      addressLine2: parsed.data.addressLine2,
      city: parsed.data.city,
      region: parsed.data.region,
      postalCode: parsed.data.postalCode,
      countryCode: parsed.data.countryCode.toUpperCase(),
      timezone: parsed.data.timezone,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      coordinateAccuracyM: parsed.data.coordinateAccuracyM,
      coordinateSource: parsed.data.coordinateSource,
      geofenceVerifiedM: parsed.data.geofenceVerifiedM,
      geofenceNearM: parsed.data.geofenceNearM,
      geofenceSuspiciousM: parsed.data.geofenceSuspiciousM,
      access: {
        create: {
          accessWindows: asInputJson(access.accessWindows),
          entryInstructions: access.entryInstructions,
          keyInstructions: access.keyInstructions,
          alarmInstructions: access.alarmInstructions,
          parkingInstructions: access.parkingInstructions,
          emergencyContactName: access.emergencyContactName,
          emergencyContactPhone: access.emergencyContactPhone,
          hazards: asInputJson(access.hazards),
          equipment: asInputJson(access.equipment),
          securityCloseDown: asInputJson(access.securityCloseDown),
        },
      },
      areas: {
        create: parsed.data.areas.map((area) => ({
          organizationId: auth.user.organizationId,
          name: area.name,
          type: area.type,
          code: area.code,
          sortOrder: area.sortOrder,
        })),
      },
      contracts: { create: contractIds.map((contractId) => ({ contractId })) },
    },
    include: { access: true, areas: { orderBy: { sortOrder: 'asc' } }, client: true },
  })
  await logAudit(auth.user.email, 'create_site', 'site', created.id, {
    clientId: client.id,
    areaCount: created.areas.length,
  }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: created }, { status: 201 })
}
