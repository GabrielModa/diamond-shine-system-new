import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { requireAuth } from '../../../../../lib/auth'

const schema = z.object({ status: z.enum(['Pending', 'Email Sent', 'Completed']) })

type DbStatus = 'Pending' | 'EmailSent' | 'Completed'

function toDbStatus(label: 'Pending' | 'Email Sent' | 'Completed'): DbStatus {
  if (label === 'Email Sent') return 'EmailSent'
  return label
}

function toLabel(status: DbStatus): 'Pending' | 'Email Sent' | 'Completed' {
  if (status === 'EmailSent') return 'Email Sent'
  return status
}

function isAllowedTransition(current: DbStatus, next: DbStatus): boolean {
  if (current === next) return true
  if (current === 'Pending' && next === 'EmailSent') return true
  if (current === 'EmailSent' && next === 'Completed') return true
  return false
}

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  console.log('[API /api/supplies/:id/status PATCH]')
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
  }

  const row = await prisma.supplyRequest.findUnique({ where: { id: context.params.id } })
  if (!row) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  const current = row.status as DbStatus
  const next = toDbStatus(parsed.data.status)

  if (!isAllowedTransition(current, next)) {
    return NextResponse.json({ ok: false, error: 'Conflict' }, { status: 409 })
  }

  const updated = await prisma.supplyRequest.update({
    where: { id: row.id },
    data: {
      status: next,
      emailSentAt:
        next === 'EmailSent' && !row.emailSentAt
          ? new Date()
          : row.emailSentAt,
      completedAt:
        next === 'Completed' && !row.completedAt
          ? new Date()
          : row.completedAt,
    },
  })

  return NextResponse.json({ ok: true, data: { id: updated.id, status: toLabel(updated.status as DbStatus) } })
}
