import { describe, expect, it } from 'vitest'
import { haversineKm, travelEstimate, workforceProfileFor } from '../../src/lib/workforce-profiles'

describe('workforce coverage helpers', () => {
  it('returns a Dublin planning profile for known and fallback employees', () => {
    expect(workforceProfileFor('maria@ds.ie').home.address).toContain('Rathmines')
    expect(workforceProfileFor('new.employee@ds.ie').home.address).toContain('Dublin')
  })

  it('calculates stable non-zero distance and a reasonable mode-aware estimate', () => {
    const distance = haversineKm({ latitude: 53.3498, longitude: -6.2603 }, { latitude: 53.3438, longitude: -6.2546 })
    expect(distance).toBeGreaterThan(0.5)
    expect(distance).toBeLessThan(1.5)
    expect(travelEstimate(distance, 'cycling')).toBeGreaterThanOrEqual(4)
    expect(travelEstimate(10, 'driving')).toBeLessThan(travelEstimate(10, 'transit'))
  })
})
