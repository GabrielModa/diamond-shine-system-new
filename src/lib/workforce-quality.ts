export type QualityBand = 'all' | 'excellent' | 'good' | 'watch' | 'issues' | 'none'

export function qualityBand(average: number | null, lowFeedbackCount = 0): Exclude<QualityBand, 'all'> {
  if (average == null) return 'none'
  if (lowFeedbackCount > 0 || average < 3.5) return 'issues'
  if (average >= 4.5) return 'excellent'
  if (average >= 4.0) return 'good'
  return 'watch'
}

export function qualityLabel(average: number | null, lowFeedbackCount = 0) {
  const band = qualityBand(average, lowFeedbackCount)
  return {
    excellent: 'Excellent',
    good: 'Strong',
    watch: 'Watch',
    issues: 'Issues',
    none: 'No feedback',
  }[band]
}

export function qualityTrend(valuesNewestFirst: number[]) {
  if (valuesNewestFirst.length < 4) return { direction: 'stable' as const, delta: 0 }
  const split = Math.ceil(valuesNewestFirst.length / 2)
  const recent = valuesNewestFirst.slice(0, split)
  const previous = valuesNewestFirst.slice(split)
  if (!previous.length) return { direction: 'stable' as const, delta: 0 }
  const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  const delta = Math.round((avg(recent) - avg(previous)) * 10) / 10
  return {
    direction: delta >= 0.3 ? 'up' as const : delta <= -0.3 ? 'down' as const : 'stable' as const,
    delta,
  }
}
