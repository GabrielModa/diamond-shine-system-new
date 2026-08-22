export type QualityScoreInput = {
  result: 'pass' | 'fail' | 'not_applicable'
  weight: number
  critical: boolean
}

export function calculateQualityScore(items: QualityScoreInput[]) {
  const applicable = items.filter((item) => item.result !== 'not_applicable')
  const totalWeight = applicable.reduce((sum, item) => sum + item.weight, 0)
  const earnedWeight = applicable
    .filter((item) => item.result === 'pass')
    .reduce((sum, item) => sum + item.weight, 0)
  const hasCriticalFailure = applicable.some((item) => item.critical && item.result === 'fail')
  const rawScore = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 100
  const score = hasCriticalFailure ? Math.min(rawScore, 49) : rawScore
  const passed = score >= 80 && !hasCriticalFailure
  const grade = score >= 95
    ? 'excellent'
    : score >= 80
      ? 'pass'
      : score >= 60
        ? 'attention'
        : 'fail'

  return { score, grade, passed, hasCriticalFailure }
}

export function correctiveDueAt(severity: 'minor' | 'major' | 'critical', from = new Date()) {
  const hours = severity === 'critical' ? 4 : severity === 'major' ? 24 : 72
  return new Date(from.getTime() + hours * 60 * 60 * 1000)
}
