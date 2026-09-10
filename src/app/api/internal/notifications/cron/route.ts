import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { processGlobalDueNotifications } from '../../../../../lib/notification-queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const provided = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret ?? ''}`)
  if (!secret || secret.length < 32 || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const results = await processGlobalDueNotifications(20)
    return NextResponse.json({ ok: true, data: {
      processed: results.filter(Boolean).length,
      sent: results.filter((result) => result?.status === 'sent').length,
      failed: results.filter((result) => result?.status === 'failed' || result?.status === 'exhausted').length,
    } })
  } catch {
    return NextResponse.json({ ok: false, error: 'Notification processing failed. Retry on the next scheduled run.' }, { status: 500 })
  }
}
