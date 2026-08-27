import { describe, expect, it } from 'vitest'
import { generateOccurrences } from '../../src/modules/scheduling/recurrence'

describe('recurrence window cursor', () => {
  it('jumps to a distant daily window without consuming the occurrence limit on history', () => {
    const occurrences = generateOccurrences({
      startAt: new Date('2027-01-01T08:00:00.000Z'),
      from: new Date('2030-09-01T00:00:00.000Z'),
      until: new Date('2030-09-04T00:00:00.000Z'),
      recurrence: { frequency: 'daily', interval: 1 },
      timezone: 'Europe/Dublin',
      limit: 10,
    })

    expect(occurrences).toHaveLength(3)
    expect(occurrences.map((item) => item.toISOString())).toEqual([
      '2030-09-01T07:00:00.000Z',
      '2030-09-02T07:00:00.000Z',
      '2030-09-03T07:00:00.000Z',
    ])
  })

  it('preserves weekly interval anchoring when jumping forward', () => {
    const occurrences = generateOccurrences({
      startAt: new Date('2027-01-04T09:00:00.000Z'),
      from: new Date('2030-09-01T00:00:00.000Z'),
      until: new Date('2030-09-30T23:59:59.000Z'),
      recurrence: { frequency: 'weekly', interval: 2, weekdays: [1, 3] },
      timezone: 'Europe/Dublin',
      limit: 20,
    })

    expect(occurrences.length).toBeGreaterThan(0)
    expect(occurrences.every((item) => item >= new Date('2030-09-01T00:00:00.000Z'))).toBe(true)
    expect(occurrences.every((item) => item <= new Date('2030-09-30T23:59:59.000Z'))).toBe(true)
  })
})
