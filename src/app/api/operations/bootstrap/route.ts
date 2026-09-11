import { NextRequest, NextResponse } from 'next/server'
import { authUserHasCapability, getAuthUser } from '../../../../lib/auth'
import { prisma } from '../../../../lib/prisma'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const canReadClients = authUserHasCapability(user, 'clients.read')
  const canReadSites = authUserHasCapability(user, 'sites.read')
  const canReadPlans = authUserHasCapability(user, 'service_plans.read')
  const canReadSchedule = authUserHasCapability(user, 'schedule.read')
  if (!canReadClients && !canReadSites && !canReadPlans) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  const organizationId = user.organizationId
  const [clients, contracts, sites, plans, memberships] = await Promise.all([
    canReadClients ? prisma.client.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { displayName: 'asc' },
      include: {
        contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
        _count: { select: { sites: true, contracts: true } },
      },
    }) : Promise.resolve([]),
    canReadClients ? prisma.contract.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        client: { select: { id: true, displayName: true } },
        sites: { include: { site: { select: { id: true, name: true, city: true } } } },
      },
    }) : Promise.resolve([]),
    canReadSites ? prisma.site.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ client: { displayName: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        clientId: true,
        name: true,
        addressLine1: true,
        city: true,
        postalCode: true,
        geofenceVerifiedM: true,
        geofenceNearM: true,
        geofenceSuspiciousM: true,
        version: true,
        client: { select: { displayName: true } },
        access: { select: { entryInstructions: true } },
        preferredAssignees: {
          orderBy: { priority: 'asc' },
          select: { user: { select: { id: true, name: true, email: true } } },
        },
        _count: { select: { areas: true, servicePlans: true } },
      },
    }) : Promise.resolve([]),
    canReadPlans ? prisma.servicePlan.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        status: true,
        expectedDurationMinutes: true,
        requiredWorkers: true,
        version: true,
        site: {
          select: {
            id: true,
            name: true,
            client: { select: { displayName: true } },
          },
        },
        _count: { select: { tasks: true, versions: true } },
      },
    }) : Promise.resolve([]),
    canReadSchedule ? prisma.membership.findMany({
      where: {
        organizationId,
        status: 'active',
        role: { in: ['employee', 'field_supervisor'] },
        user: { status: 'active', workforceProfile: { is: { weeklyTargetConfigured: true } } },
      },
      orderBy: { user: { name: 'asc' } },
      select: {
        role: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }) : Promise.resolve([]),
  ])

  return NextResponse.json({
    ok: true,
    data: {
      clients,
      contracts,
      sites,
      plans,
      team: memberships.map((membership) => ({ ...membership.user, role: membership.role })),
    },
  })
}
