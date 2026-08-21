import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../../lib/prisma'
import { requireAuth } from '../../../../../lib/auth'
import { logAudit } from '../../../../../lib/audit'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response
  const { id } = await params
  const updated = await prisma.notificationJob.updateMany({
    where: { id, status: { in: ['failed', 'exhausted'] } },
    data: { status: 'queued', attempts: 0, nextAttemptAt: new Date(), lastError: null },
  })
  if (!updated.count) return NextResponse.json({ ok: false, error: 'Notification cannot be retried' }, { status: 409 })
  await logAudit(auth.user.email, 'retry_notification', 'notification', id)
  return NextResponse.json({ ok: true, data: { id, status: 'queued' } })
}
