import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { siteUpdateSchema } from '../../../../modules/operations/schemas'
import { asInputJson } from '../../../../modules/operations/json'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'sites.read')
  if ('response' in auth) return auth.response
  const { id } = await params
  const site = await prisma.site.findFirst({
    where: { id, organizationId: auth.user.organizationId },
    include: {
      client: true,
      access: true,
      areas: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
      contracts: { include: { contract: true } },
      servicePlans: { where: { archivedAt: null }, orderBy: { updatedAt: 'desc' } },
      preferredAssignees: { orderBy: { priority: 'asc' }, include: { user: { select: { id: true, name: true, email: true } } } },
    },
  })
  if (!site) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, data: site })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'sites.manage')
  if ('response' in auth) return auth.response
  const { id } = await params
  const parsed = siteUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }
  const current = await prisma.site.findFirst({
    where: { id, organizationId: auth.user.organizationId, archivedAt: null },
  })
  if (!current) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  if (current.version !== parsed.data.version) {
    return NextResponse.json({ ok: false, error: 'Version conflict' }, { status: 409 })
  }

  const contractIds = parsed.data.contractIds ? [...new Set(parsed.data.contractIds)] : null
  const preferredAssigneeIds = parsed.data.preferredAssigneeIds ? [...new Set(parsed.data.preferredAssigneeIds)] : null
  if (contractIds) {
    const count = await prisma.contract.count({
      where: {
        id: { in: contractIds },
        organizationId: auth.user.organizationId,
        clientId: current.clientId,
        archivedAt: null,
      },
    })
    if (count !== contractIds.length) {
      return NextResponse.json({ ok: false, error: 'Every contract must belong to this site client.' }, { status: 400 })
    }
  }
  if (preferredAssigneeIds) {
    const count = await prisma.membership.count({ where: { organizationId: auth.user.organizationId, userId: { in: preferredAssigneeIds }, status: 'active' } })
    if (count !== preferredAssigneeIds.length) return NextResponse.json({ ok: false, error: 'Every preferred team member must be active in this organization.' }, { status: 400 })
  }

  const site = await prisma.$transaction(async (tx) => {
    await tx.site.update({
      where: { id },
      data: {
        name: parsed.data.name,
        addressLine1: parsed.data.addressLine1,
        addressLine2: parsed.data.addressLine2,
        city: parsed.data.city,
        region: parsed.data.region,
        postalCode: parsed.data.postalCode,
        countryCode: parsed.data.countryCode?.toUpperCase(),
        timezone: parsed.data.timezone,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        coordinateAccuracyM: parsed.data.coordinateAccuracyM,
        coordinateSource: parsed.data.coordinateSource,
        geofenceVerifiedM: parsed.data.geofenceVerifiedM,
        geofenceNearM: parsed.data.geofenceNearM,
        geofenceSuspiciousM: parsed.data.geofenceSuspiciousM,
        version: { increment: 1 },
      },
    })
    if (parsed.data.access) {
      const access = parsed.data.access
      await tx.siteAccess.upsert({
        where: { siteId: id },
        update: {
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
        create: {
          siteId: id,
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
      })
    }
    if (contractIds) {
      await tx.contractSite.deleteMany({ where: { siteId: id } })
      await tx.contractSite.createMany({ data: contractIds.map((contractId) => ({ contractId, siteId: id })) })
    }
    if (preferredAssigneeIds) {
      await tx.sitePreferredAssignee.deleteMany({ where: { siteId: id } })
      if (preferredAssigneeIds.length) await tx.sitePreferredAssignee.createMany({ data: preferredAssigneeIds.map((userId, priority) => ({ organizationId: auth.user.organizationId, siteId: id, userId, priority })) })
    }
    return tx.site.findUniqueOrThrow({ where: { id }, include: { access: true, areas: true, preferredAssignees: { orderBy: { priority: 'asc' }, include: { user: { select: { id: true, name: true, email: true } } } } } })
  })
  await logAudit(auth.user.email, 'update_site', 'site', id, { version: site.version }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: site })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'sites.manage')
  if ('response' in auth) return auth.response
  const { id } = await params
  const version = Number(request.nextUrl.searchParams.get('version'))
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ ok: false, error: 'Version is required' }, { status: 400 })
  }
  const result = await prisma.site.updateMany({
    where: { id, organizationId: auth.user.organizationId, version, archivedAt: null },
    data: { status: 'archived', archivedAt: new Date(), version: { increment: 1 } },
  })
  if (!result.count) return NextResponse.json({ ok: false, error: 'Not found or version conflict' }, { status: 409 })
  await logAudit(auth.user.email, 'archive_site', 'site', id, undefined, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: { id, archived: true } })
}
