import { describe, expect, it } from 'vitest'
import { generateOccurrences } from '../../src/modules/scheduling/recurrence'

describe('timezone-aware recurrence', () => {
  it('keeps 18:00 Europe/Dublin across the autumn DST change', () => {
    const starts = generateOccurrences({
      startAt: new Date('2026-10-19T17:00:00.000Z'),
      until: new Date('2026-11-03T23:00:00.000Z'),
      timezone: 'Europe/Dublin',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [1] },
    })
    expect(starts.map((item) => item.toISOString())).toEqual([
      '2026-10-19T17:00:00.000Z',
      '2026-10-26T18:00:00.000Z',
      '2026-11-02T18:00:00.000Z',
    ])
  })
  it('preserves legacy UTC recurrence when timezone is omitted', () => {
    const starts = generateOccurrences({ startAt: new Date('2026-08-24T08:00:00.000Z'), until: new Date('2026-09-06T23:00:00.000Z'), recurrence: { frequency: 'weekly', interval: 1, weekdays: [1,3] } })
    expect(starts).toHaveLength(4)
    expect(starts.map((item) => item.getUTCDay())).toEqual([1,3,1,3])
  })
})
