import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../../lib/prisma'
import { requireCapability } from '../../../lib/auth'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(10).max(100).default(30),
  search: z.string().trim().max(200).optional(),
  targetType: z.string().trim().max(80).optional(),
  actor: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'audit.read')
  if ('response' in auth) return auth.response
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  if (parsed.data.from && parsed.data.to && parsed.data.to < parsed.data.from) {
    return NextResponse.json({ ok: false, error: 'To must be after from.' }, { status: 400 })
  }
  const where: Prisma.AuditLogWhereInput = {
    organizationId: auth.user.organizationId,
    ...(parsed.data.targetType ? { targetType: parsed.data.targetType } : {}),
    ...(parsed.data.actor ? { actorEmail: { contains: parsed.data.actor, mode: 'insensitive' } } : {}),
    ...(parsed.data.from || parsed.data.to ? { createdAt: { gte: parsed.data.from, lte: parsed.data.to } } : {}),
    ...(parsed.data.search ? {
      OR: [
        { action: { contains: parsed.data.search, mode: 'insensitive' } },
        { actorEmail: { contains: parsed.data.search, mode: 'insensitive' } },
        { targetType: { contains: parsed.data.search, mode: 'insensitive' } },
        { targetId: { contains: parsed.data.search, mode: 'insensitive' } },
      ],
    } : {}),
  }
  const skip = (parsed.data.page - 1) * parsed.data.limit
  const [total, items, targetRows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: parsed.data.limit }),
    prisma.auditLog.findMany({
      where: { organizationId: auth.user.organizationId },
      select: { targetType: true },
      distinct: ['targetType'],
      orderBy: { targetType: 'asc' },
      take: 100,
    }),
  ])
  return NextResponse.json({ ok: true, data: {
    items,
    total,
    page: parsed.data.page,
    limit: parsed.data.limit,
    totalPages: Math.max(1, Math.ceil(total / parsed.data.limit)),
    targetTypes: targetRows.map((row) => row.targetType),
  } })
}
