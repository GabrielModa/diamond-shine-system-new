import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../../lib/prisma'
import { addOperationalDays, operationalDateKey, operationalDayRange } from '../../../../../lib/operational-time'
import { ensureScheduleContinuity } from '../../../../../modules/scheduling/continuity'

export const dynamic = 'force-dynamic'

const querySchema = z.object({ horizonDays: z.coerce.number().int().min(30).max(365).default(120) })

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

  const organizations = await prisma.organization.findMany({
    where: { status: 'active' },
    select: { id: true, timezone: true },
  })
  const results = []
  for (const organization of organizations) {
    const now = new Date()
    const today = operationalDayRange(now, organization.timezone)
    const from = new Date(today.from)
    const horizonKey = addOperationalDays(operationalDateKey(now, organization.timezone), parsed.data.horizonDays)
    const to = new Date(operationalDayRange(horizonKey, organization.timezone).from)
    const result = await ensureScheduleContinuity({ organizationId: organization.id, from, to })
    results.push({ organizationId: organization.id, ...result })
  }
  return NextResponse.json({
    ok: true,
    data: {
      organizations: results.length,
      jobsChecked: results.reduce((sum, item) => sum + item.jobsChecked, 0),
      generatedVisits: results.reduce((sum, item) => sum + item.generatedVisits, 0),
      pausedOccurrences: results.reduce((sum, item) => sum + item.pausedOccurrences, 0),
      staffingGaps: results.reduce((sum, item) => sum + item.staffingGaps, 0),
      results,
    },
  })
}
