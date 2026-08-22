import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '../../../../lib/prisma'
import { requireCapability } from '../../../../lib/auth'

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'quality.inspect')
  if ('response' in auth) return auth.response
  const organizationId = auth.user.organizationId
  const now = new Date()
  const since = new Date(now.getTime() - 30 * 86_400_000)
  const [inspections, actions, sites] = await Promise.all([
    prisma.qualityInspection.findMany({
      where: { organizationId, inspectedAt: { gte: since } },
      include: {
        site: { select: { id: true, name: true, client: { select: { displayName: true } } } },
        inspector: { select: { name: true, email: true } },
        _count: { select: { actions: true } },
      },
      orderBy: { inspectedAt: 'desc' },
      take: 200,
    }),
    prisma.correctiveAction.findMany({
      where: { organizationId, status: { notIn: ['verified', 'waived'] } },
      include: {
        site: { select: { id: true, name: true, client: { select: { displayName: true } } } },
        assignedTo: { select: { id: true, name: true, email: true } },
        inspection: { select: { id: true, score: true, inspectedAt: true } },
      },
      orderBy: [{ severity: 'desc' }, { dueAt: 'asc' }],
      take: 200,
    }),
    prisma.site.findMany({
      where: { organizationId, archivedAt: null },
      select: {
        id: true,
        name: true,
        client: { select: { displayName: true } },
        qualityInspections: { orderBy: { inspectedAt: 'desc' }, take: 1, select: { inspectedAt: true, score: true, passed: true } },
      },
      orderBy: { name: 'asc' },
      take: 500,
    }),
  ])
  const scored = inspections.length
  const averageScore = scored ? Math.round(inspections.reduce((sum, item) => sum + item.score, 0) / scored) : null
  const openActions = actions.filter((item) => !['resolved', 'verified', 'waived'].includes(item.status))

  return NextResponse.json({
    ok: true,
    data: {
      range: { since, now },
      summary: {
        inspections: inspections.length,
        averageScore,
        passRate: scored ? Math.round((inspections.filter((item) => item.passed).length / scored) * 100) : null,
        openActions: openActions.length,
        overdueActions: openActions.filter((item) => item.dueAt < now).length,
        criticalActions: openActions.filter((item) => item.severity === 'critical').length,
        uninspectedSites: sites.filter((site) => !site.qualityInspections[0]).length,
      },
      inspections,
      actions,
      sites,
    },
  })
}
