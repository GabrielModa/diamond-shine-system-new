import { describe, expect, it } from 'vitest'
import { qualityBand, qualityLabel, qualityTrend } from '../../src/lib/workforce-quality'

describe('workforce quality', () => {
  it('classifies feedback bands for manager filters', () => {
    expect(qualityBand(null)).toBe('none')
    expect(qualityBand(4.8)).toBe('excellent')
    expect(qualityBand(4.2)).toBe('good')
    expect(qualityBand(3.7)).toBe('watch')
    expect(qualityBand(3.2)).toBe('issues')
    expect(qualityBand(4.7, 1)).toBe('issues')
    expect(qualityLabel(4.8)).toBe('Excellent')
  })

  it('detects meaningful recent quality trend', () => {
    expect(qualityTrend([5, 4.8, 4.1, 4])).toMatchObject({ direction: 'up' })
    expect(qualityTrend([3.6, 3.7, 4.5, 4.6])).toMatchObject({ direction: 'down' })
    expect(qualityTrend([4.2, 4.1])).toMatchObject({ direction: 'stable' })
  })
})
