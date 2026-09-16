import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser } from '../../../../lib/auth'
import { dbCategoryToLabel } from '../../../../lib/mappers'
import { prisma } from '../../../../lib/prisma'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(30).default(10),
})

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })

  const where = {
    organizationId: user.organizationId,
    employeeId: user.id,
  }
  const { page, pageSize } = parsed.data
  const [total, items, aggregate] = await Promise.all([
    prisma.feedbackEntry.count({ where }),
    prisma.feedbackEntry.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        clientLocation: true,
        cleanliness: true,
        punctuality: true,
        equipment: true,
        clientRelations: true,
        overall: true,
        category: true,
        comments: true,
        createdAt: true,
      },
    }),
    prisma.feedbackEntry.aggregate({
      where,
      _avg: {
        overall: true,
        cleanliness: true,
        punctuality: true,
        equipment: true,
        clientRelations: true,
      },
    }),
  ])

  return NextResponse.json({
    ok: true,
    data: {
      total,
      items: items.map((item) => ({
        ...item,
        category: dbCategoryToLabel(item.category as 'Excellent' | 'VeryGood' | 'Good' | 'Fair' | 'Poor'),
      })),
      metrics: {
        overall: aggregate._avg.overall ?? 0,
        cleanliness: aggregate._avg.cleanliness ?? 0,
        punctuality: aggregate._avg.punctuality ?? 0,
        equipment: aggregate._avg.equipment ?? 0,
        clientRelations: aggregate._avg.clientRelations ?? 0,
      },
      pagination: {
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        hasMore: page * pageSize < total,
      },
    },
  })
}
