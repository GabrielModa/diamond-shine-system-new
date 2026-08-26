import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../lib/auth'
import { prisma } from '../../../lib/prisma'
import { materialState } from '../../../modules/materials/catalog'
import { operationalHealth, siteRisk } from '../../../modules/intelligence/scoring'
import { isActiveAssignmentStatus } from '../../../modules/scheduling/assignment-lifecycle'

const DAY = 86_400_000
const ACTIVE_SUPPLY = ['Requested', 'Triaged', 'Approved', 'Ordered', 'InTransit']

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'visits.review')
  if ('response' in auth) return auth.response
  const organizationId = auth.user.organizationId
  const now = new Date()
  const since = new Date(now.getTime() - 30 * DAY)
  const upcomingTo = new Date(now.getTime() + 7 * DAY)
  const [sites, visits, inspections, actions, stock, supplyRequests, noticeRecipients, feedback] = await Promise.all([
    prisma.site.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, name: true, city: true, client: { select: { displayName: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.visit.findMany({
      where: {
        organizationId,
        status: { notIn: ['cancelled', 'missed'] },
        scheduledStart: { gte: since, lte: upcomingTo },
      },
      include: {
        site: { select: { id: true, name: true, client: { select: { displayName: true } } } },
        job: { select: { defaultDurationMin: true } },
        assignments: { select: { id: true, userId: true, status: true, acknowledgedAt: true, user: { select: { id: true, name: true, email: true } } } },
        timeEntries: { select: { id: true, userId: true, status: true, startedAt: true, durationSeconds: true, startLocationClass: true } },
        taskResults: { select: { status: true } },
        incidents: { select: { status: true, severity: true } },
      },
      orderBy: { scheduledStart: 'asc' },
    }),
    prisma.qualityInspection.findMany({
      where: { organizationId, inspectedAt: { gte: since } },
      select: { id: true, siteId: true, score: true, passed: true, inspectedAt: true },
      orderBy: { inspectedAt: 'desc' },
    }),
    prisma.correctiveAction.findMany({
      where: { organizationId, status: { notIn: ['verified', 'waived'] } },
      select: { id: true, siteId: true, title: true, severity: true, status: true, dueAt: true },
      orderBy: { dueAt: 'asc' },
    }),
    prisma.siteStockLevel.findMany({ where: { organizationId }, include: { catalogItem: { select: { name: true } } } }),
    prisma.supplyRequest.findMany({
      where: { organizationId, status: { in: ACTIVE_SUPPLY } },
      select: { id: true, siteId: true, priority: true, dueAt: true, clientLocation: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.operationalNoticeRecipient.findMany({
      where: { organizationId, deliveredAt: { gte: since }, notice: { requiresAcknowledgement: true } },
      select: { acknowledgedAt: true, notice: { select: { siteId: true, title: true, priority: true } } },
    }),
    prisma.feedbackEntry.findMany({
      where: { organizationId, createdAt: { gte: since } },
      select: { employeeId: true, employeeName: true, overall: true },
    }),
  ])

  const historical = visits.filter((visit) => visit.scheduledStart <= now)
  const upcoming = visits.filter((visit) => visit.scheduledStart > now)
  const completed = historical.filter((visit) => visit.status === 'completed')
  const timeEntries = historical.flatMap((visit) => visit.timeEntries.map((entry) => ({ ...entry, visit })))
  const completedEntries = timeEntries.filter((entry) => entry.durationSeconds != null && ['completed', 'approved', 'needs_review'].includes(entry.status))
  const reviewEntries = timeEntries.filter((entry) => entry.status === 'needs_review' || ['suspicious', 'unavailable'].includes(entry.startLocationClass ?? ''))
  const plannedMinutes = completed.reduce((sum, visit) => sum + visit.job.defaultDurationMin, 0)
  const actualMinutes = Math.round(completedEntries.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0) / 60)
  const qualityAverage = inspections.length ? Math.round(inspections.reduce((sum, item) => sum + item.score, 0) / inspections.length) : null
  const riskyStock = stock.filter((item) => materialState(item) !== 'healthy')
  const awaitingAck = noticeRecipients.filter((recipient) => !recipient.acknowledgedAt)
  const openIncidents = historical.flatMap((visit) => visit.incidents.map((incident) => ({ ...incident, visit }))).filter((item) => !['resolved', 'closed'].includes(item.status))
  const criticalIssues = openIncidents.filter((item) => item.severity === 'critical').length + actions.filter((item) => item.severity === 'critical').length

  const healthInputs = {
    completionRate: historical.length ? completed.length / historical.length * 100 : 100,
    qualityScore: qualityAverage,
    timeAnomalyRate: completedEntries.length ? reviewEntries.length / completedEntries.length * 100 : 0,
    stockRiskRate: stock.length ? riskyStock.length / stock.length * 100 : 0,
    acknowledgementGapRate: noticeRecipients.length ? awaitingAck.length / noticeRecipients.length * 100 : 0,
    criticalIssueRate: sites.length ? criticalIssues / sites.length * 100 : 0,
  }
  const health = operationalHealth(healthInputs)
  const healthComponents = [
    { key: 'completion', label: 'Service completion', weight: 30, value: Math.round(healthInputs.completionRate), direction: 'higher_is_better' },
    { key: 'quality', label: 'Quality', weight: 25, value: Math.round(healthInputs.qualityScore ?? 100), direction: 'higher_is_better' },
    { key: 'time', label: 'Time confidence', weight: 15, value: Math.round(100 - healthInputs.timeAnomalyRate), direction: 'higher_is_better' },
    { key: 'stock', label: 'Material readiness', weight: 15, value: Math.round(100 - healthInputs.stockRiskRate), direction: 'higher_is_better' },
    { key: 'ack', label: 'Communication acknowledgement', weight: 10, value: Math.round(100 - healthInputs.acknowledgementGapRate), direction: 'higher_is_better' },
    { key: 'critical', label: 'Critical issue control', weight: 5, value: Math.round(100 - healthInputs.criticalIssueRate), direction: 'higher_is_better' },
  ]

  const siteRisks = sites.map((site) => {
    const siteVisits = historical.filter((visit) => visit.siteId === site.id)
    const siteUpcoming = upcoming.filter((visit) => visit.siteId === site.id)
    const siteInspections = inspections.filter((item) => item.siteId === site.id)
    const siteActions = actions.filter((item) => item.siteId === site.id)
    const siteStock = stock.filter((item) => item.siteId === site.id)
    const siteNotices = noticeRecipients.filter((item) => item.notice.siteId === site.id && !item.acknowledgedAt)
    const signals = {
      missedOrBlocked: siteVisits.filter((item) => item.status === 'completion_blocked').length,
      criticalIncidents: siteVisits.flatMap((item) => item.incidents).filter((item) => item.severity === 'critical' && !['resolved', 'closed'].includes(item.status)).length,
      highIncidents: siteVisits.flatMap((item) => item.incidents).filter((item) => item.severity === 'high' && !['resolved', 'closed'].includes(item.status)).length,
      overdueActions: siteActions.filter((item) => item.dueAt < now).length,
      criticalActions: siteActions.filter((item) => item.severity === 'critical').length,
      outOfStock: siteStock.filter((item) => materialState(item) === 'out').length,
      needsReorder: siteStock.filter((item) => materialState(item) === 'reorder').length,
      unacknowledged: siteNotices.length,
      unassignedUpcoming: siteUpcoming.filter((item) => item.assignments.filter((assignment) => isActiveAssignmentStatus(assignment.status)).length < item.requiredWorkers).length,
      latestQualityScore: siteInspections[0]?.score ?? null,
    }
    return { ...site, ...siteRisk(signals), signals, nextVisit: siteUpcoming[0]?.scheduledStart ?? null }
  }).sort((a, b) => b.score - a.score)

  const team = new Map<string, { id: string; name: string; visits: Set<string>; minutes: number; anomalies: number; ratings: number[] }>()
  for (const visit of historical) for (const assignment of visit.assignments.filter((item) => isActiveAssignmentStatus(item.status))) {
    const row = team.get(assignment.user.id) ?? { id: assignment.user.id, name: assignment.user.name || assignment.user.email, visits: new Set<string>(), minutes: 0, anomalies: 0, ratings: [] }
    if (visit.status === 'completed') row.visits.add(visit.id)
    for (const entry of visit.timeEntries.filter((item) => item.userId === assignment.user.id)) {
      row.minutes += Math.round((entry.durationSeconds ?? 0) / 60)
      if (entry.status === 'needs_review') row.anomalies += 1
    }
    team.set(assignment.user.id, row)
  }
  for (const item of feedback) if (item.employeeId && team.has(item.employeeId)) team.get(item.employeeId)!.ratings.push(item.overall)

  const actionsNow = [
    ...siteRisks.filter((site) => site.level === 'critical').slice(0, 5).map((site) => ({ priority: 'critical', title: `Stabilise ${site.name}`, detail: site.reasons.slice(0, 3).join(' · '), href: '/field-control' })),
    ...actions.filter((item) => item.dueAt < now).slice(0, 5).map((item) => ({ priority: item.severity, title: item.title, detail: 'Corrective action is overdue', href: '/quality' })),
    ...supplyRequests.filter((item) => item.dueAt && item.dueAt < now).slice(0, 5).map((item) => ({ priority: item.priority === 'urgent' ? 'critical' : 'high', title: `Supply request · ${item.clientLocation}`, detail: 'Replenishment is overdue', href: '/supplies' })),
  ].slice(0, 10)

  return NextResponse.json({ ok: true, data: {
    generatedAt: now,
    range: { since, upcomingTo },
    health: { ...health, components: healthComponents },
    summary: {
      historicalVisits: historical.length,
      completedVisits: completed.length,
      completionRate: historical.length ? Math.round(completed.length / historical.length * 100) : 100,
      plannedMinutes,
      actualMinutes,
      laborVariancePercent: plannedMinutes ? Math.round((actualMinutes - plannedMinutes) / plannedMinutes * 100) : 0,
      timeAnomalies: reviewEntries.length,
      qualityAverage,
      qualityPassRate: inspections.length ? Math.round(inspections.filter((item) => item.passed).length / inspections.length * 100) : null,
      materialRisks: riskyStock.length,
      openSupplyRequests: supplyRequests.length,
      openCorrectiveActions: actions.length,
      acknowledgementGaps: awaitingAck.length,
      unassignedUpcoming: upcoming.filter((visit) => visit.assignments.filter((assignment) => isActiveAssignmentStatus(assignment.status)).length < visit.requiredWorkers).length,
    },
    siteRisks,
    actionsNow,
    team: Array.from(team.values()).map((item) => ({
      id: item.id,
      name: item.name,
      completedVisits: item.visits.size,
      minutes: item.minutes,
      anomalies: item.anomalies,
      rating: item.ratings.length ? Math.round(item.ratings.reduce((sum, value) => sum + value, 0) / item.ratings.length * 10) / 10 : null,
    })).sort((a, b) => b.completedVisits - a.completedVisits),
  } })
}
