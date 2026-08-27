import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCapability } from '../../../lib/auth'
import { buildScheduleHealth } from '../../../modules/scheduling/schedule-health'
import { ensureScheduleContinuity } from '../../../modules/scheduling/continuity'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
})

const ensureSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  jobIds: z.array(z.string().min(1)).max(100).optional(),
})

function managerHealthAllowed(role: string) {
  return role !== 'employee'
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.read')
  if ('response' in auth) return auth.response
  if (!managerHealthAllowed(auth.user.membershipRole)) {
    return NextResponse.json({ ok: false, error: 'Schedule health is a management view.' }, { status: 403 })
  }
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()))
  if (!parsed.success || parsed.data.to <= parsed.data.from) {
    return NextResponse.json({ ok: false, error: 'Invalid schedule health range.' }, { status: 400 })
  }
  const data = await buildScheduleHealth({
    organizationId: auth.user.organizationId,
    from: parsed.data.from,
    to: parsed.data.to,
  })
  return NextResponse.json({ ok: true, data })
}

export async function POST(request: NextRequest) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth.response
  const parsed = ensureSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || parsed.data.to <= parsed.data.from) {
    return NextResponse.json({ ok: false, error: 'Invalid continuity request.', details: parsed.success ? undefined : parsed.error.flatten() }, { status: 400 })
  }
  const result = await ensureScheduleContinuity({
    organizationId: auth.user.organizationId,
    from: parsed.data.from,
    to: parsed.data.to,
    jobIds: parsed.data.jobIds,
  })
  const health = await buildScheduleHealth({
    organizationId: auth.user.organizationId,
    from: parsed.data.from,
    to: parsed.data.to,
  })
  return NextResponse.json({ ok: true, data: { result, health } })
}
