import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { servicePauseEndSchema } from '../../../../modules/scheduling/schemas'

function scopeVisitWhere(pause: { scope: 'client' | 'site' | 'job'; clientId: string | null; siteId: string | null; jobId: string | null }) {
  if (pause.scope === 'client') return { site: { clientId: pause.clientId as string } }
  if (pause.scope === 'site') return { siteId: pause.siteId as string }
  return { jobId: pause.jobId as string }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'schedule.manage')
  if ('response' in auth) return auth.response
  const parsed = servicePauseEndSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request.', details: parsed.error.flatten() }, { status: 400 })
  const { id } = await params
  const pause = await prisma.servicePause.findFirst({ where: { id, organizationId: auth.user.organizationId } })
  if (!pause) return NextResponse.json({ ok: false, error: 'Service pause not found.' }, { status: 404 })
  if (pause.version !== parsed.data.version) return NextResponse.json({ ok: false, error: 'Service pause changed. Refresh and try again.' }, { status: 409 })
  if (pause.endedEarlyAt) return NextResponse.json({ ok: false, error: 'This service pause has already ended early.' }, { status: 409 })
  const now = new Date()
  if (now >= pause.endsAt) return NextResponse.json({ ok: false, error: 'This service pause has already finished.' }, { status: 409 })

  const affectedFutureVisits = await prisma.visit.count({
    where: {
      organizationId: auth.user.organizationId,
      ...scopeVisitWhere(pause),
      servicePauseId: pause.id,
      status: 'cancelled',
      scheduledStart: { gt: now, lt: pause.endsAt },
    },
  })
  const updated = await prisma.servicePause.update({
    where: { id: pause.id },
    data: { endedEarlyAt: now, endedEarlyById: auth.user.id, version: { increment: 1 } },
  })
  await logAudit(auth.user.email, 'end_service_pause_early', 'service_pause', pause.id, {
    previousEndsAt: pause.endsAt,
    endedEarlyAt: now,
    affectedFutureVisits,
  }, auth.user.organizationId)
  return NextResponse.json({
    ok: true,
    data: {
      pause: updated,
      affectedFutureVisits,
      message: affectedFutureVisits
        ? `${affectedFutureVisits} future cancelled visit${affectedFutureVisits === 1 ? '' : 's'} may now need scheduling review. Historical cancellations were not rewritten.`
        : 'Service resumed early. Historical cancellations were not rewritten.',
    },
  })
}
