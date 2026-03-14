import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { CLIENT_LOCATIONS } from '../../../lib/constants'
import { prisma } from '../../../lib/prisma'
import { requireAuth } from '../../../lib/auth'
import { sendSuppliesNotification } from '../../../lib/email'

const schema = z.object({
  employeeName: z.string().min(1),
  clientLocation: z.enum(CLIENT_LOCATIONS),
  priority: z.enum(['urgent', 'normal', 'low']),
  products: z.array(z.string()).min(1),
  notes: z.string().max(500).optional(),
})

export async function POST(request: NextRequest) {
  console.log('[API /api/supplies POST]')
  const auth = await requireAuth(request, ['admin', 'supervisor', 'employee'])
  if ('response' in auth) return auth.response

  const parsed = schema.safeParse(await request.json().catch(() => null))
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

  return NextResponse.json({ ok: true, data: { id: created.id } }, { status: 201 })
}

export async function GET(request: NextRequest) {
  console.log('[API /api/supplies GET]')
  const auth = await requireAuth(request, ['admin', 'supervisor'])
  if ('response' in auth) return auth.response

  const items = await prisma.supplyRequest.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ ok: true, data: { total: items.length, items } })
}
