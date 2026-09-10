export type HealthInputs = {
  completionRate: number | null
  qualityScore: number | null
  timeAnomalyRate: number | null
  stockRiskRate: number | null
  acknowledgementGapRate: number | null
  criticalIssueRate: number | null
}

export function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
}

export function operationalHealth(input: HealthInputs) {
  const components = [
    { value: input.completionRate, weight: 0.30, invert: false },
    { value: input.qualityScore, weight: 0.25, invert: false },
    { value: input.timeAnomalyRate, weight: 0.15, invert: true },
    { value: input.stockRiskRate, weight: 0.15, invert: true },
    { value: input.acknowledgementGapRate, weight: 0.10, invert: true },
    { value: input.criticalIssueRate, weight: 0.05, invert: true },
  ].filter((component) => component.value != null)

  const availableWeight = components.reduce((sum, component) => sum + component.weight, 0)
  if (!availableWeight) return { score: null, grade: 'no_data', confidence: 0 } as const

  const weighted = components.reduce((sum, component) => {
    const value = clampPercent(component.value as number)
    return sum + (component.invert ? 100 - value : value) * component.weight
  }, 0)
  const score = Math.round(weighted / availableWeight)
  return {
    score,
    grade: score >= 90 ? 'excellent' : score >= 78 ? 'healthy' : score >= 65 ? 'watch' : 'critical',
    confidence: Math.round(availableWeight * 100),
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
