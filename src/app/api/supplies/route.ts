import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { CLIENT_LOCATIONS, PRODUCTS } from '../../../lib/constants'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { sendSuppliesNotification } from '../../../lib/email'
import { dbStatusToLabel } from '../../../lib/mappers'
import { parseStringArray } from '../../../lib/json'
import { logAudit } from '../../../lib/audit'
import { calculateSupplyDueAt } from '../../../lib/business-logic'

const itemSchema = z.object({
  product: z.string().min(1).refine((value) => PRODUCTS.some((item) => item.value === value), 'Unknown product'),
  quantity: z.number().int().min(1).max(999),
})

const createSchema = z.object({
  employeeName: z.string().min(1),
  clientLocation: z.enum(CLIENT_LOCATIONS),
  priority: z.enum(['urgent', 'normal', 'low']),
  items: z.array(itemSchema).min(1).optional(),
  products: z.array(z.string()).min(1).optional(),
  notes: z.string().max(500).optional(),
}).refine((value) => Boolean(value.items?.length || value.products?.length), { message: 'At least one item is required' })

const querySchema = z.object({
  status: z.enum(['requested', 'triaged', 'approved', 'ordered', 'in-transit', 'delivered', 'rejected', 'cancelled']).optional(),
  priority: z.enum(['urgent', 'normal', 'low']).optional(),
  search: z.string().optional(),
  mine: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
})

export async function POST(request: NextRequest) {
  console.log('[API /api/supplies POST]')
  const auth = await requireAuth(request, ['admin', 'supervisor', 'employee'])
  if ('response' in auth) return auth.response

  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const items = parsed.data.items ?? parsed.data.products!.map((product) => ({ product, quantity: 1 }))
  if (new Set(items.map((item) => item.product)).size !== items.length) {
    return NextResponse.json({ ok: false, error: 'Duplicate products are not allowed' }, { status: 400 })
  }

  const created = await prisma.supplyRequest.create({
    data: {
      employeeName: parsed.data.employeeName,
      clientLocation: parsed.data.clientLocation,
      priority: parsed.data.priority,
      products: JSON.stringify(items.map((item) => item.product)),
      items: { create: items },
      statusEvents: {
        create: { toStatus: 'Requested', actorEmail: auth.user.email, note: 'Request submitted' },
      },
      notes: parsed.data.notes,
      submittedBy: auth.user.email,
      status: 'Requested',
      dueAt: calculateSupplyDueAt(parsed.data.priority),
    },
  })

  const notification = await sendSuppliesNotification({
    id: created.id,
    employeeName: created.employeeName,
    clientLocation: created.clientLocation,
    priority: created.priority,
    products: items.map((item) => item.product),
    items,
    notes: created.notes ?? undefined,
    submittedBy: created.submittedBy,
    createdAt: created.createdAt,
  })

  await logAudit(auth.user.email, 'create_supply', 'supply', created.id, {
    employeeName: created.employeeName,
    priority: created.priority,
    notificationSent: notification.ok,
  })

  return NextResponse.json({ ok: true, data: { id: created.id, notificationSent: notification.ok } }, { status: 201 })
}

export async function GET(request: NextRequest) {
  console.log('[API /api/supplies GET]')
  const auth = await requireAuth(request, ['admin', 'supervisor', 'employee'])
  if ('response' in auth) return auth.response

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  }

  const where: Prisma.SupplyRequestWhereInput = {}

  if (auth.user.role === 'employee' || parsed.data.mine === 'true') {
    where.submittedBy = auth.user.email
  }

  if (parsed.data.status) {
    where.status = parsed.data.status === 'in-transit'
      ? 'InTransit'
      : parsed.data.status.charAt(0).toUpperCase() + parsed.data.status.slice(1)
  }
  if (parsed.data.priority) where.priority = parsed.data.priority
  if (parsed.data.search) {
    where.OR = [
      { employeeName: { contains: parsed.data.search } },
      { clientLocation: { contains: parsed.data.search } },
    ]
  }

  const skip = (parsed.data.page - 1) * parsed.data.limit
  const [total, items] = await Promise.all([
    prisma.supplyRequest.count({ where }),
    prisma.supplyRequest.findMany({
      where,
      include: { items: true, statusEvents: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parsed.data.limit,
    }),
  ])

  const mappedItems = items.map((item) => {
    const products = parseStringArray(item.products)
    return {
      ...item,
      status: dbStatusToLabel(item.status as import('../../../lib/mappers').DbSupplyStatus),
      products,
      items: item.items.length ? item.items.map(({ product, quantity }) => ({ product, quantity })) : products.map((product) => ({ product, quantity: 1 })),
      history: item.statusEvents.map((event) => ({
        ...event,
        toStatus: dbStatusToLabel(event.toStatus as import('../../../lib/mappers').DbSupplyStatus),
        fromStatus: event.fromStatus
          ? dbStatusToLabel(event.fromStatus as import('../../../lib/mappers').DbSupplyStatus)
          : null,
      })),
    }
  })

  return NextResponse.json({
    ok: true,
    data: { total, page: parsed.data.page, limit: parsed.data.limit, items: mappedItems },
  })
}
