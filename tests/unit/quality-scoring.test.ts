import { describe, expect, it } from 'vitest'
import { calculateQualityScore, correctiveDueAt } from '../../src/modules/quality/scoring'

describe('quality scoring', () => {
  it('weights applicable checks and ignores not applicable checks', () => {
    expect(calculateQualityScore([
      { result: 'pass', weight: 3, critical: false },
      { result: 'fail', weight: 1, critical: false },
      { result: 'not_applicable', weight: 20, critical: true },
    ])).toEqual({ score: 75, grade: 'attention', passed: false, hasCriticalFailure: false })
  })

  it('caps a critical failure below the passing threshold', () => {
    const result = calculateQualityScore([
      { result: 'pass', weight: 20, critical: false },
      { result: 'fail', weight: 1, critical: true },
    ])
    expect(result.score).toBe(49)
    expect(result.passed).toBe(false)
    expect(result.hasCriticalFailure).toBe(true)
  })

  it('uses severity-specific corrective deadlines', () => {
    const start = new Date('2026-08-22T00:00:00.000Z')
    expect(correctiveDueAt('critical', start).toISOString()).toBe('2026-08-22T04:00:00.000Z')
    expect(correctiveDueAt('major', start).toISOString()).toBe('2026-08-23T00:00:00.000Z')
    expect(correctiveDueAt('minor', start).toISOString()).toBe('2026-08-25T00:00:00.000Z')
  })
})
