import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'
import { logAudit } from '../../../../lib/audit'
import { clientUpdateSchema } from '../../../../modules/operations/schemas'
import { isManualExtraRecurrence } from '../../../../modules/operations/client-lifecycle'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'clients.read')
  if ('response' in auth) return auth.response
  const { id } = await params

  const client = await prisma.client.findFirst({
    where: { id, organizationId: auth.user.organizationId },
    include: {
      contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
      contracts: { where: { archivedAt: null }, orderBy: { createdAt: 'desc' } },
      sites: { where: { archivedAt: null }, orderBy: { name: 'asc' } },
    },
  })
  if (!client) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, data: client })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'clients.manage')
  if ('response' in auth) return auth.response
  const { id } = await params
  const parsed = clientUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  const { version, ...changes } = parsed.data
  const updated = await prisma.client.updateMany({
    where: { id, organizationId: auth.user.organizationId, version, archivedAt: null },
    data: { ...changes, version: { increment: 1 } },
  })
  if (!updated.count) {
    const exists = await prisma.client.count({ where: { id, organizationId: auth.user.organizationId } })
    return NextResponse.json(
      { ok: false, error: exists ? 'Version conflict' : 'Not found' },
      { status: exists ? 409 : 404 }
    )
  }

  const client = await prisma.client.findUniqueOrThrow({ where: { id } })
  await logAudit(auth.user.email, 'update_client', 'client', id, { version: client.version }, auth.user.organizationId)
  return NextResponse.json({ ok: true, data: client })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(request, 'clients.manage')
  if ('response' in auth) return auth.response
  const { id } = await params
  const parsed = z.coerce.number().int().min(1).safeParse(request.nextUrl.searchParams.get('version'))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Version is required' }, { status: 400 })

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM clients WHERE id = ${id} AND "organizationId" = ${auth.user.organizationId} FOR UPDATE`
      const client = await tx.client.findFirst({
        where: { id, organizationId: auth.user.organizationId, version: parsed.data, archivedAt: null },
      })
      if (!client) throw new Error('Client changed. Refresh and try again.')

      const now = new Date()
      const [jobs, operationalVisits] = await Promise.all([
        tx.job.findMany({
          where: {
            organizationId: auth.user.organizationId,
            site: { clientId: id },
            archivedAt: null,
            status: { in: ['draft', 'active', 'paused'] },
          },
          select: { id: true, status: true, endDate: true, recurrence: true },
        }),
        tx.visit.count({
          where: {
            organizationId: auth.user.organizationId,
            site: { clientId: id },
            status: { in: ['scheduled', 'dispatched', 'acknowledged', 'in_progress', 'completion_blocked'] },
          },
        }),
      ])

      const currentRecurringJobs = jobs.filter((job) =>
        !isManualExtraRecurrence(job.recurrence)
        && (!job.endDate || job.endDate > now),
      )
      if (currentRecurringJobs.length || operationalVisits) {
        throw new Error('End all active services and complete or cancel outstanding visits, including manual extras, before archiving this client.')
      }

      // Future-dated service ends become terminal by time even if no request runs
      // exactly at the boundary. Normalize those stale Job statuses while archiving.
      const expiredRecurringJobIds = jobs
        .filter((job) => !isManualExtraRecurrence(job.recurrence) && job.endDate && job.endDate <= now)
        .map((job) => job.id)
      if (expiredRecurringJobIds.length) {
        await tx.job.updateMany({
          where: { id: { in: expiredRecurringJobIds }, organizationId: auth.user.organizationId },
          data: { status: 'completed', version: { increment: 1 } },
        })
      }

      await tx.client.update({
        where: { id },
        data: { status: 'archived', archivedAt: now, version: { increment: 1 } },
      })
      await tx.site.updateMany({
        where: { clientId: id, organizationId: auth.user.organizationId, archivedAt: null },
        data: { archivedAt: now, version: { increment: 1 } },
      })
      await tx.servicePlan.updateMany({
        where: { site: { clientId: id }, organizationId: auth.user.organizationId, archivedAt: null },
        data: { archivedAt: now, version: { increment: 1 } },
      })
      await tx.contract.updateMany({
        where: { clientId: id, organizationId: auth.user.organizationId, archivedAt: null },
        data: { archivedAt: now, version: { increment: 1 } },
      })
      await tx.job.updateMany({
        where: { site: { clientId: id }, organizationId: auth.user.organizationId, archivedAt: null },
        data: { archivedAt: now, version: { increment: 1 } },
      })
      await tx.auditLog.create({
        data: {
          organizationId: auth.user.organizationId,
          actorEmail: auth.user.email,
          action: 'archive_client',
          targetType: 'client',
          targetId: id,
          metadata: JSON.stringify({
            historicalRecordsPreserved: true,
            normalizedExpiredRecurringJobs: expiredRecurringJobIds,
          }),
        },
      })
    }, { isolationLevel: 'Serializable' })

    return NextResponse.json({ ok: true, data: { id, archived: true } })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error && !('code' in error)
        ? error.message
        : 'Operational work changed. Refresh and retry.',
    }, { status: 409 })
  }
}
