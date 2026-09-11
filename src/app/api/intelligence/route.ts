import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '../../../lib/auth'
import { prisma } from '../../../lib/prisma'
import { materialState } from '../../../modules/materials/catalog'
import { operationalHealth, siteRisk } from '../../../modules/intelligence/scoring'

const DAY = 86_400_000
const ACTIVE_SUPPLY = ['Requested', 'Triaged', 'Approved', 'Ordered', 'InTransit']

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
}
function percent(numerator: number, denominator: number) {
  return denominator ? Math.round(numerator / denominator * 100) : null
}
function delta(current: number | null, previous: number | null) {
  return current != null && previous != null ? current - previous : null
}

export async function GET(request: NextRequest) {
  const auth = await requireCapability(request, 'visits.review')
  if ('response' in auth) return auth.response

  const organizationId = auth.user.organizationId
  const now = new Date()
  const currentSince = new Date(now.getTime() - 30 * DAY)
  const previousSince = new Date(now.getTime() - 60 * DAY)

  const [sites, visits, inspections, actions, stock, supplyRequests, noticeRecipients] = await Promise.all([
    prisma.site.findMany({
      where: { organizationId, archivedAt: null },
      select: { id: true, name: true, city: true, client: { select: { displayName: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.visit.findMany({
      where: {
        organizationId,
        status: { notIn: ['cancelled', 'missed'] },
        scheduledStart: { gte: previousSince, lte: now },
      },
      select: {
        id: true,
        siteId: true,
        status: true,
        scheduledStart: true,
        requiredWorkers: true,
        job: { select: { defaultDurationMin: true } },
        timeEntries: { select: { id: true, kind: true, status: true, durationSeconds: true, startLocationClass: true } },
        incidents: { select: { status: true, severity: true } },
      },
      orderBy: { scheduledStart: 'asc' },
    }),
    prisma.qualityInspection.findMany({
      where: { organizationId, inspectedAt: { gte: previousSince, lte: now } },
      select: { id: true, siteId: true, score: true, passed: true, inspectedAt: true },
      orderBy: { inspectedAt: 'desc' },
    }),
    prisma.correctiveAction.findMany({
      where: { organizationId, status: { notIn: ['verified', 'waived'] } },
      select: { id: true, siteId: true, title: true, severity: true, status: true, dueAt: true },
      orderBy: { dueAt: 'asc' },
    }),
    prisma.siteStockLevel.findMany({
      where: { organizationId },
      select: { siteId: true, onHand: true, parLevel: true, reorderPoint: true },
    }),
    prisma.supplyRequest.findMany({
      where: { organizationId, status: { in: ACTIVE_SUPPLY } },
      select: { id: true, siteId: true, priority: true, dueAt: true, clientLocation: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.operationalNoticeRecipient.findMany({
      where: { organizationId, deliveredAt: { gte: currentSince }, notice: { requiresAcknowledgement: true } },
      select: { acknowledgedAt: true, notice: { select: { siteId: true, title: true, priority: true } } },
    }),
  ])

  const currentVisits = visits.filter((visit) => visit.scheduledStart >= currentSince)
  const previousVisits = visits.filter((visit) => visit.scheduledStart < currentSince)
  const currentCompleted = currentVisits.filter((visit) => visit.status === 'completed')
  const previousCompleted = previousVisits.filter((visit) => visit.status === 'completed')

  const currentEntries = currentVisits.flatMap((visit) => visit.timeEntries)
  const previousEntries = previousVisits.flatMap((visit) => visit.timeEntries)
  const currentRecorded = currentEntries.filter((entry) => entry.kind === 'visit' && entry.durationSeconds != null && ['completed', 'approved', 'needs_review'].includes(entry.status))
  const previousRecorded = previousEntries.filter((entry) => entry.kind === 'visit' && entry.durationSeconds != null && ['completed', 'approved', 'needs_review'].includes(entry.status))
  const currentReview = currentRecorded.filter((entry) => entry.status === 'needs_review' || ['suspicious', 'unavailable'].includes(entry.startLocationClass ?? ''))
  const previousReview = previousRecorded.filter((entry) => entry.status === 'needs_review' || ['suspicious', 'unavailable'].includes(entry.startLocationClass ?? ''))

  const plannedMinutes = currentCompleted.reduce((sum, visit) => sum + visit.job.defaultDurationMin * Math.max(1, visit.requiredWorkers), 0)
  const previousPlannedMinutes = previousCompleted.reduce((sum, visit) => sum + visit.job.defaultDurationMin * Math.max(1, visit.requiredWorkers), 0)
  const actualMinutes = Math.round(currentRecorded.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0) / 60)
  const previousActualMinutes = Math.round(previousRecorded.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0) / 60)
  const laborVariancePercent = plannedMinutes ? Math.round((actualMinutes - plannedMinutes) / plannedMinutes * 100) : null
  const previousLaborVariancePercent = previousPlannedMinutes ? Math.round((previousActualMinutes - previousPlannedMinutes) / previousPlannedMinutes * 100) : null

  const currentInspections = inspections.filter((item) => item.inspectedAt >= currentSince)
  const previousInspections = inspections.filter((item) => item.inspectedAt < currentSince)
  const qualityAverage = average(currentInspections.map((item) => item.score))
  const previousQualityAverage = average(previousInspections.map((item) => item.score))
  const qualityPassRate = percent(currentInspections.filter((item) => item.passed).length, currentInspections.length)

  const riskyStock = stock.filter((item) => materialState(item) !== 'healthy')
  const awaitingAck = noticeRecipients.filter((recipient) => !recipient.acknowledgedAt)
  const currentOpenIncidents = currentVisits.flatMap((visit) => visit.incidents).filter((item) => !['resolved', 'closed'].includes(item.status))
  const previousOpenIncidents = previousVisits.flatMap((visit) => visit.incidents).filter((item) => !['resolved', 'closed'].includes(item.status))
  const criticalIssues = currentOpenIncidents.filter((item) => item.severity === 'critical').length + actions.filter((item) => item.severity === 'critical').length

  const completionRate = percent(currentCompleted.length, currentVisits.length)
  const previousCompletionRate = percent(previousCompleted.length, previousVisits.length)
  const healthInputs = {
    completionRate,
    qualityScore: qualityAverage,
    timeAnomalyRate: currentRecorded.length ? currentReview.length / currentRecorded.length * 100 : null,
    stockRiskRate: stock.length ? riskyStock.length / stock.length * 100 : null,
    acknowledgementGapRate: noticeRecipients.length ? awaitingAck.length / noticeRecipients.length * 100 : null,
    criticalIssueRate: sites.length ? criticalIssues / sites.length * 100 : null,
  }
  const health = operationalHealth(healthInputs)
  const healthComponents = [
    { key: 'completion', label: 'Service completion', weight: 30, value: healthInputs.completionRate, direction: 'higher_is_better' },
    { key: 'quality', label: 'Quality', weight: 25, value: healthInputs.qualityScore, direction: 'higher_is_better' },
    { key: 'time', label: 'Time confidence', weight: 15, value: healthInputs.timeAnomalyRate == null ? null : Math.round(100 - healthInputs.timeAnomalyRate), direction: 'higher_is_better' },
    { key: 'stock', label: 'Material readiness', weight: 15, value: healthInputs.stockRiskRate == null ? null : Math.round(100 - healthInputs.stockRiskRate), direction: 'higher_is_better' },
    { key: 'ack', label: 'Communication acknowledgement', weight: 10, value: healthInputs.acknowledgementGapRate == null ? null : Math.round(100 - healthInputs.acknowledgementGapRate), direction: 'higher_is_better' },
    { key: 'critical', label: 'Critical issue control', weight: 5, value: healthInputs.criticalIssueRate == null ? null : Math.round(100 - healthInputs.criticalIssueRate), direction: 'higher_is_better' },
  ]

  const visitsBySite = new Map<string, typeof currentVisits>()
  for (const visit of currentVisits) {
    const rows = visitsBySite.get(visit.siteId) ?? []
    rows.push(visit)
    visitsBySite.set(visit.siteId, rows)
  }
  const inspectionsBySite = new Map<string, typeof currentInspections>()
  for (const inspection of currentInspections) {
    const rows = inspectionsBySite.get(inspection.siteId) ?? []
    rows.push(inspection)
    inspectionsBySite.set(inspection.siteId, rows)
  }
  const actionsBySite = new Map<string, typeof actions>()
  for (const action of actions) {
    const rows = actionsBySite.get(action.siteId) ?? []
    rows.push(action)
    actionsBySite.set(action.siteId, rows)
  }
  const stockBySite = new Map<string, typeof stock>()
  for (const item of stock) {
    const rows = stockBySite.get(item.siteId) ?? []
    rows.push(item)
    stockBySite.set(item.siteId, rows)
  }
  const noticesBySite = new Map<string, typeof awaitingAck>()
  for (const recipient of awaitingAck) {
    const siteId = recipient.notice.siteId
    if (!siteId) continue
    const rows = noticesBySite.get(siteId) ?? []
    rows.push(recipient)
    noticesBySite.set(siteId, rows)
  }

  const siteRisks = sites.map((site) => {
    const siteVisits = visitsBySite.get(site.id) ?? []
    const siteInspections = inspectionsBySite.get(site.id) ?? []
    const siteActions = actionsBySite.get(site.id) ?? []
    const siteStock = stockBySite.get(site.id) ?? []
    const siteNotices = noticesBySite.get(site.id) ?? []
    const signals = {
      missedOrBlocked: siteVisits.filter((item) => item.status === 'completion_blocked').length,
      criticalIncidents: siteVisits.flatMap((item) => item.incidents).filter((item) => item.severity === 'critical' && !['resolved', 'closed'].includes(item.status)).length,
      highIncidents: siteVisits.flatMap((item) => item.incidents).filter((item) => item.severity === 'high' && !['resolved', 'closed'].includes(item.status)).length,
      overdueActions: siteActions.filter((item) => item.dueAt < now).length,
      criticalActions: siteActions.filter((item) => item.severity === 'critical').length,
      outOfStock: siteStock.filter((item) => materialState(item) === 'out').length,
      needsReorder: siteStock.filter((item) => materialState(item) === 'reorder').length,
      unacknowledged: siteNotices.length,
      latestQualityScore: siteInspections[0]?.score ?? null,
    }
    return { ...site, ...siteRisk(signals), signals }
  }).sort((a, b) => b.score - a.score)

  return NextResponse.json({
    ok: true,
    data: {
      generatedAt: now,
      range: { currentSince, previousSince },
      health: { ...health, components: healthComponents },
      summary: {
        historicalVisits: currentVisits.length,
        completedVisits: currentCompleted.length,
        completionRate,
        plannedMinutes,
        actualMinutes,
        laborVariancePercent,
        timeAnomalies: currentReview.length,
        qualityAverage,
        qualityPassRate,
        materialRisks: riskyStock.length,
        openSupplyRequests: supplyRequests.length,
        openCorrectiveActions: actions.length,
        acknowledgementGaps: awaitingAck.length,
        openIncidents: currentOpenIncidents.length,
      },
      trends: {
        completionRate: { current: completionRate, previous: previousCompletionRate, delta: delta(completionRate, previousCompletionRate) },
        quality: { current: qualityAverage, previous: previousQualityAverage, delta: delta(qualityAverage, previousQualityAverage) },
        laborVariance: { current: laborVariancePercent, previous: previousLaborVariancePercent, delta: delta(laborVariancePercent, previousLaborVariancePercent) },
        incidents: { current: currentOpenIncidents.length, previous: previousOpenIncidents.length, delta: currentOpenIncidents.length - previousOpenIncidents.length },
        timeExceptions: { current: currentReview.length, previous: previousReview.length, delta: currentReview.length - previousReview.length },
      },
      siteRisks,
    },
  })
}
