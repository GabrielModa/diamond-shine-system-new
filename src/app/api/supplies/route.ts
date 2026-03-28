import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { CLIENT_LOCATIONS } from '../../../lib/constants'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { sendSuppliesNotification } from '../../../lib/email'
import { dbStatusToLabel } from '../../../lib/mappers'
import { parseStringArray } from '../../../lib/json'
import { logAudit } from '../../../lib/audit'

const createSchema = z.object({
  employeeName: z.string().min(1),
  clientLocation: z.enum(CLIENT_LOCATIONS),
  priority: z.enum(['urgent', 'normal', 'low']),
  products: z.array(z.string()).min(1),
  notes: z.string().max(500).optional(),
})

const querySchema = z.object({
  status: z.enum(['pending', 'email-sent', 'completed']).optional(),
  priority: z.enum(['urgent', 'normal', 'low']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export async function POST(request: NextRequest) {
  console.log('[API /api/supplies POST]')
  const auth = await requireAuth(request, ['admin', 'supervisor', 'employee'])
  if ('response' in auth) return auth.response

  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const created = await prisma.supplyRequest.create({
    data: {
      employeeName: parsed.data.employeeName,
      clientLocation: parsed.data.clientLocation,
      priority: parsed.data.priority,
      products: JSON.stringify(parsed.data.products),
      notes: parsed.data.notes,
      submittedBy: auth.user.email,
      status: 'Pending',
    },
  })

  void sendSuppliesNotification({
    id: created.id,
    employeeName: created.employeeName,
    clientLocation: created.clientLocation,
    priority: created.priority,
    products: parsed.data.products,
    notes: created.notes ?? undefined,
    submittedBy: created.submittedBy,
  })

  await logAudit(auth.user.email, 'create_supply', 'supply', created.id, {
    employeeName: created.employeeName,
    priority: created.priority,
  })

  return NextResponse.json({ ok: true, data: { id: created.id } }, { status: 201 })
}

export async function GET(request: NextRequest) {
  console.log('[API /api/supplies GET]')
  const auth = await requireAuth(request, ['admin', 'supervisor'])
  if ('response' in auth) return auth.response

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  }

  const where: Prisma.SupplyRequestWhereInput = {}

  if (parsed.data.status) {
    where.status =
      parsed.data.status === 'pending'
        ? 'Pending'
        : parsed.data.status === 'email-sent'
          ? 'EmailSent'
          : 'Completed'
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
    prisma.supplyRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: parsed.data.limit }),
  ])

  const mappedItems = items.map((item) => ({
    ...item,
    status: dbStatusToLabel(item.status as 'Pending' | 'EmailSent' | 'Completed'),
    products: parseStringArray(item.products),
  }))

  return NextResponse.json({
    ok: true,
    data: { total, page: parsed.data.page, limit: parsed.data.limit, items: mappedItems },
  })
}
