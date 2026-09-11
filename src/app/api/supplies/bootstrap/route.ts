import { NextRequest, NextResponse } from 'next/server'
import { authUserHasCapability, requireCapability } from '../../../../lib/auth'
import { parseStringArray } from '../../../../lib/json'
import { dbStatusToLabel } from '../../../../lib/mappers'
import { prisma } from '../../../../lib/prisma'
import { ensureDefaultMaterialCatalog, materialState } from '../../../../modules/materials/catalog'

const ACTIVE_REQUEST_STATUSES = ['Requested', 'Triaged', 'Approved', 'Ordered', 'InTransit'] as const

function mapSupply(item: {
  id: string
  employeeName: string
  clientLocation: string
  priority: import('@prisma/client').SupplyPriority
  products: string
  notes: string | null
  status: string
  submittedBy: string
  emailSentAt: Date | null
  completedAt: Date | null
  dueAt: Date | null
  assignedTo: string | null
  siteId: string | null
  visitId: string | null
  source: string
  createdAt: Date
  updatedAt: Date
  items: Array<{ catalogItemId: string | null; product: string; quantity: number; currentQuantity: number | null; targetQuantity: number | null }>
  statusEvents: Array<{ id: string; requestId: string; fromStatus: string | null; toStatus: string; actorEmail: string; note: string | null; createdAt: Date }>
}) {
  const products = parseStringArray(item.products)
  return {
    ...item,
    status: dbStatusToLabel(item.status as import('../../../../lib/mappers').DbSupplyStatus),
    products,
    items: item.items.length
      ? item.items.map(({ product, quantity, catalogItemId, currentQuantity, targetQuantity }) => ({ product, quantity, catalogItemId, currentQuantity, targetQuantity }))
      : products.map((product) => ({ product, quantity: 1 })),
    history: item.statusEvents.map((event) => ({
      ...event,
      toStatus: dbStatusToLabel(event.toStatus as import('../../../../lib/mappers').DbSupplyStatus),
      fromStatus: event.fromStatus ? dbStatusToLabel(event.fromStatus as import('../../../../lib/mappers').DbSupplyStatus) : null,
    })),
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'supplies.request')
  if ('response' in auth) return auth.response

  const organizationId = auth.user.organizationId
  const canManage = authUserHasCapability(auth.user, 'supplies.manage')
  await ensureDefaultMaterialCatalog(organizationId)

  const requestWhere = {
    organizationId,
    ...(!canManage ? { submittedBy: auth.user.email } : {}),
  }

  const [
    sites,
    catalog,
    requestRows,
    levels,
    sitesWithoutCount,
    openRequests,
    overdueRequests,
    assigneeMemberships,
  ] = await Promise.all([
    prisma.site.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ client: { displayName: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        client: { select: { displayName: true } },
      },
    }),
    prisma.materialCatalogItem.findMany({
      where: { organizationId, active: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    }),
    prisma.supplyRequest.findMany({
      where: requestWhere,
      include: {
        items: true,
        statusEvents: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    }),
    canManage ? prisma.siteStockLevel.findMany({
      where: { organizationId },
      include: {
        site: { select: { id: true, name: true, client: { select: { displayName: true } } } },
        catalogItem: true,
      },
      orderBy: [{ site: { name: 'asc' } }, { catalogItem: { name: 'asc' } }],
    }) : Promise.resolve([]),
    canManage ? prisma.site.count({
      where: { organizationId, archivedAt: null, stockLevels: { none: {} } },
    }) : Promise.resolve(0),
    canManage ? prisma.supplyRequest.count({
      where: { organizationId, status: { in: [...ACTIVE_REQUEST_STATUSES] } },
    }) : Promise.resolve(0),
    canManage ? prisma.supplyRequest.count({
      where: {
        organizationId,
        status: { in: [...ACTIVE_REQUEST_STATUSES] },
        dueAt: { lt: new Date() },
      },
    }) : Promise.resolve(0),
    canManage ? prisma.membership.findMany({
      where: {
        organizationId,
        status: 'active',
        role: { in: ['organization_admin', 'field_supervisor', 'stock_controller'] },
        user: { status: 'active' },
      },
      select: {
        role: true,
        user: { select: { email: true, name: true } },
      },
      orderBy: [{ role: 'asc' }, { user: { name: 'asc' } }],
    }) : Promise.resolve([]),
  ])

  const requests = requestRows.map(mapSupply)
  const mappedLevels = levels.map((level) => ({
    ...level,
    state: materialState(level),
    daysRemaining: level.estimatedDailyUse && Number(level.estimatedDailyUse) > 0
      ? Math.round((level.onHand / Number(level.estimatedDailyUse)) * 10) / 10
      : null,
  }))
  const control = canManage ? {
    summary: {
      tracked: levels.length,
      outOfStock: mappedLevels.filter((level) => level.state === 'out').length,
      needsReorder: mappedLevels.filter((level) => level.state === 'reorder').length,
      openRequests,
      overdueRequests,
      sitesWithoutCount,
    },
    levels: mappedLevels,
    requests: requests.filter((item) => !['Delivered', 'Rejected', 'Cancelled'].includes(item.status)),
  } : null

  return NextResponse.json({
    ok: true,
    data: {
      sites,
      catalog,
      requests,
      control,
      assignees: assigneeMemberships.map((membership) => ({
        email: membership.user.email,
        name: membership.user.name,
        role: membership.role,
        status: 'active',
      })),
    },
  })
}
