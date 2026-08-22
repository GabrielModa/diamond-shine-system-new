import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { processDueNotifications } from '../../../../lib/notification-queue'

const schema = z.object({ limit: z.number().int().min(1).max(50).default(20) })

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, ['admin'])
  if ('response' in auth) return auth.response
  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })

  const results = await processDueNotifications(auth.user.organizationId, parsed.data.limit)
  await logAudit(
    auth.user.email,
    'process_notification_queue',
    'notification',
    undefined,
    { count: results.length },
    auth.user.organizationId
  )
  return NextResponse.json({ ok: true, data: { processed: results.length, results } })
}
