import { describe, expect, it } from 'vitest'
import { classifyAvailabilityNotice, workforceProfileReady } from '../../src/modules/workforce/profile-policy'

describe('workforce profile product policy', () => {
  const now = new Date('2026-08-28T10:00:00.000Z')

  it('classifies availability by lead time without blocking submission', () => {
    expect(classifyAvailabilityNotice(new Date('2026-08-29T09:59:59.999Z'), now)).toBe('urgent')
    expect(classifyAvailabilityNotice(new Date('2026-08-29T10:00:00.000Z'), now)).toBe('late')
    expect(classifyAvailabilityNotice(new Date('2026-09-04T09:59:59.999Z'), now)).toBe('late')
    expect(classifyAvailabilityNotice(new Date('2026-09-04T10:00:00.000Z'), now)).toBe('planned')
  })

  it('requires explicit manager confirmation before automatic scheduling', () => {
    expect(workforceProfileReady(null)).toBe(false)
    expect(workforceProfileReady({ weeklyTargetConfigured: false })).toBe(false)
    expect(workforceProfileReady({ weeklyTargetConfigured: true })).toBe(true)
  })
})
