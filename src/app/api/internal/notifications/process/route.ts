import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { processGlobalDueNotifications } from '../../../../../lib/notification-queue'

export const dynamic = 'force-dynamic'

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(250).default(100) })

function secretMatches(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer)
}

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.NOTIFICATION_WORKER_SECRET
  const providedSecret = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!configuredSecret || configuredSecret.length < 32 || !secretMatches(providedSecret, configuredSecret)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid query' }, { status: 400 })
  const results = await processGlobalDueNotifications(parsed.data.limit)
  return NextResponse.json({
    ok: true,
    data: {
      processed: results.filter(Boolean).length,
      sent: results.filter((result) => result?.status === 'sent').length,
      failed: results.filter((result) => result?.status === 'failed' || result?.status === 'exhausted').length,
    },
  })
}
