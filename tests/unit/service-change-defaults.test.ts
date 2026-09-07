import { describe, expect, it } from 'vitest'
import { calendarDateInZone, nextServiceChangeDate } from '../../src/components/clients/service-change-defaults'

describe('service change defaults', () => {
  it('defaults the effective date to the next occurrence in the current service rule', () => {
    const date = nextServiceChangeDate({
      startDate: '2026-09-07T18:30:00.000Z',
      recurrence: { frequency: 'weekly', interval: 1, weekdays: [1, 4] },
    }, 'Europe/Dublin', new Date('2026-09-08T10:00:00.000Z'))

    expect(date).toBe('2026-09-10')
  })

  it('keeps the site timezone authoritative when deriving the calendar date', () => {
    expect(calendarDateInZone(new Date('2026-10-25T23:30:00.000Z'), 'Europe/Dublin')).toBe('2026-10-25')
    expect(calendarDateInZone(new Date('2026-10-25T23:30:00.000Z'), 'America/New_York')).toBe('2026-10-25')
  })

  it('falls back to the following local date when the service has no usable recurring job', () => {
    const date = nextServiceChangeDate(undefined, 'Europe/Dublin', new Date('2026-09-07T17:00:00.000Z'))
    expect(date).toBe('2026-09-08')
  })
})
