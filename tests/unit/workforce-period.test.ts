import { describe, expect, it } from 'vitest'
import { resolveWorkforcePeriod } from '../../src/lib/workforce-period'

describe('workforce period semantics', () => {
  const tuesday = new Date('2026-08-25T10:00:00.000Z')
  it('7 days means exactly 7 calendar dates and 5 weekdays', () => {
    const period = resolveWorkforcePeriod({ range: 'week' }, tuesday, 'Europe/Dublin')!
    expect(period.weekdays).toBe(5)
    expect(period.from.toISOString()).toBe('2026-08-18T23:00:00.000Z')
  })
  it('14 days means exactly 14 calendar dates and 10 weekdays', () => expect(resolveWorkforcePeriod({ range: 'fortnight' }, tuesday, 'Europe/Dublin')!.weekdays).toBe(10))
  it('supports same-day custom ranges and rejects reverse ranges', () => {
    expect(resolveWorkforcePeriod({ from: '2026-08-25', to: '2026-08-25' }, tuesday, 'Europe/Dublin')!.weekdays).toBe(1)
    expect(resolveWorkforcePeriod({ from: '2026-08-26', to: '2026-08-25' }, tuesday, 'Europe/Dublin')).toBeNull()
  })
  it('crosses leap-day boundaries without changing calendar semantics', () => {
    const p = resolveWorkforcePeriod({ from: '2028-02-28', to: '2028-03-01' }, new Date('2028-03-01T10:00:00Z'), 'Europe/Dublin')!
    expect(p.weekdays).toBe(3)
  })
})
