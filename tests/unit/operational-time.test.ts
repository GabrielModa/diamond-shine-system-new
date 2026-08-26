import { describe, expect, it } from 'vitest'
import {
  operationalDateKey,
  operationalDayRange,
  operationalDateTimeInput,
  operationalInputToUtc,
  zonedDateTimeToUtc,
} from '../../src/lib/operational-time'

describe('operational time', () => {
  it('uses the organization timezone for the operational date', () => {
    expect(operationalDateKey('2026-08-25T23:30:00.000Z', 'Europe/Dublin')).toBe('2026-08-26')
    expect(operationalDateTimeInput('2026-08-25T23:30:00.000Z', 'Europe/Dublin')).toBe('2026-08-26T00:30')
  })

  it('keeps a local schedule input at the intended Dublin wall-clock time', () => {
    expect(operationalInputToUtc('2026-08-26T09:00', 'Europe/Dublin').toISOString()).toBe('2026-08-26T08:00:00.000Z')
  })

  it('produces a 23-hour operational day when DST begins', () => {
    const range = operationalDayRange('2026-03-29T12:00:00.000Z', 'Europe/Dublin')
    expect((new Date(range.to).getTime() - new Date(range.from).getTime()) / 3_600_000).toBe(23)
  })

  it('produces a 25-hour operational day when DST ends', () => {
    const range = operationalDayRange('2026-10-25T12:00:00.000Z', 'Europe/Dublin')
    expect((new Date(range.to).getTime() - new Date(range.from).getTime()) / 3_600_000).toBe(25)
    expect(zonedDateTimeToUtc('2026-10-26', '00:00', 'Europe/Dublin').toISOString()).toBe(range.to)
  })
})
