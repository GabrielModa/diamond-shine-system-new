export type HealthInputs = {
  completionRate: number
  qualityScore: number | null
  timeAnomalyRate: number
  stockRiskRate: number
  acknowledgementGapRate: number
  criticalIssueRate: number
}

export function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

export function operationalHealth(input: HealthInputs) {
  const score = Math.round(
    clampPercent(input.completionRate) * 0.3 +
    clampPercent(input.qualityScore ?? 100) * 0.25 +
    (100 - clampPercent(input.timeAnomalyRate)) * 0.15 +
    (100 - clampPercent(input.stockRiskRate)) * 0.15 +
    (100 - clampPercent(input.acknowledgementGapRate)) * 0.1 +
    (100 - clampPercent(input.criticalIssueRate)) * 0.05
  )
  return {
    score,
    grade: score >= 90 ? 'excellent' : score >= 78 ? 'healthy' : score >= 65 ? 'watch' : 'critical',
  } as const
}

export type SiteRiskSignals = {
  missedOrBlocked: number
  criticalIncidents: number
  highIncidents: number
  overdueActions: number
  criticalActions: number
  outOfStock: number
  needsReorder: number
  unacknowledged: number
  unassignedUpcoming: number
  latestQualityScore: number | null
}

export function siteRisk(signals: SiteRiskSignals) {
  const reasons: string[] = []
  let score = 0
  const add = (points: number, label: string, count = 1) => {
    if (!count) return
    score += points * count
    reasons.push(count > 1 ? `${label} (${count})` : label)
  }
  add(22, 'missed or blocked visit', signals.missedOrBlocked)
  add(30, 'critical incident', signals.criticalIncidents)
  add(14, 'high-severity incident', signals.highIncidents)
  add(18, 'overdue corrective action', signals.overdueActions)
  add(24, 'critical corrective action', signals.criticalActions)
  add(18, 'material out of stock', signals.outOfStock)
  add(7, 'material near reorder', signals.needsReorder)
  add(8, 'message awaiting acknowledgement', signals.unacknowledged)
  add(18, 'upcoming visit without a team', signals.unassignedUpcoming)
  if (signals.latestQualityScore != null && signals.latestQualityScore < 85) {
    score += Math.min(30, Math.ceil((85 - signals.latestQualityScore) * 1.5))
    reasons.push(`quality score ${signals.latestQualityScore}`)
  }
  const normalized = Math.min(100, score)
  return {
    score: normalized,
    level: normalized >= 60 ? 'critical' : normalized >= 30 ? 'high' : normalized >= 12 ? 'watch' : 'healthy',
    reasons,
  } as const
}
