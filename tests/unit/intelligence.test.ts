import { describe, expect, it } from 'vitest'
import { operationalHealth, siteRisk } from '../../src/modules/intelligence/scoring'

describe('operational intelligence scoring', () => {
  it('keeps a clean operation at full health and degrades explainably', () => {
    expect(operationalHealth({ completionRate: 100, qualityScore: 100, timeAnomalyRate: 0, stockRiskRate: 0, acknowledgementGapRate: 0, criticalIssueRate: 0 })).toEqual({ score: 100, grade: 'excellent', confidence: 100 })
    expect(operationalHealth({ completionRate: 50, qualityScore: 60, timeAnomalyRate: 50, stockRiskRate: 25, acknowledgementGapRate: 20, criticalIssueRate: 40 })).toEqual({ score: 60, grade: 'critical', confidence: 100 })
  })

  it('does not treat missing operational data as perfect performance', () => {
    expect(operationalHealth({ completionRate: 80, qualityScore: null, timeAnomalyRate: null, stockRiskRate: null, acknowledgementGapRate: null, criticalIssueRate: null })).toEqual({
      score: 80,
      grade: 'healthy',
      confidence: 30,
    })
    expect(operationalHealth({ completionRate: null, qualityScore: null, timeAnomalyRate: null, stockRiskRate: null, acknowledgementGapRate: null, criticalIssueRate: null })).toEqual({
      score: null,
      grade: 'no_data',
      confidence: 0,
    })
  })

  it('turns site signals into ranked reasons without exceeding one hundred', () => {
    const risk = siteRisk({ missedOrBlocked: 2, criticalIncidents: 1, highIncidents: 0, overdueActions: 1, criticalActions: 1, outOfStock: 2, needsReorder: 0, unacknowledged: 1, latestQualityScore: 60 })
    expect(risk.score).toBe(100)
    expect(risk.level).toBe('critical')
    expect(risk.reasons).toEqual(expect.arrayContaining(['missed or blocked visit (2)', 'critical incident', 'quality score 60']))
  })
})
