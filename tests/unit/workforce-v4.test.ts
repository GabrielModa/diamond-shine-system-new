import { describe, expect, it } from 'vitest'
import {
  capacityBand,
  remainingCapacityMinutes,
  resolveWorkforceContext,
} from '../../src/lib/workforce-availability'

const home = { kind: 'home' as const, label: 'Home', address: 'Tallaght', latitude: 53.28, longitude: -6.34 }
const school = { kind: 'school' as const, label: 'Test College', address: 'Dublin 2', latitude: 53.34, longitude: -6.26 }

describe('workforce availability rules', () => {
  it('keeps the always-school demo at school for a full-day schedule', () => {
    const now = new Date('2026-08-25T12:00:00Z')
    const result = resolveWorkforceContext({
      timezone: 'Europe/Dublin',
      home,
      school,
      studySchedule: [{ dayOfWeek: 2, startsMinute: 0, endsMinute: 1440 }],
      leaves: [],
    }, now)

    expect(result.state).toBe('school')
    expect(result.origin?.kind).toBe('school')
  })

  it('falls back to home during a school holiday without removing availability', () => {
    const now = new Date('2026-08-25T12:00:00Z')
    const result = resolveWorkforceContext({
      timezone: 'Europe/Dublin',
      home,
      school,
      studySchedule: [{ dayOfWeek: 2, startsMinute: 0, endsMinute: 1440 }],
      leaves: [{
        kind: 'school_holiday',
        startsAt: '2026-08-25T00:00:00Z',
        endsAt: '2026-08-26T00:00:00Z',
      }],
    }, now)

    expect(result.state).toBe('home')
    expect(result.origin?.kind).toBe('home')
    expect(result.availableForScheduling).toBe(true)
    expect(result.schoolHolidayActive).toBe(true)
  })

  it('personal leave takes precedence over school and removes the map origin', () => {
    const now = new Date('2026-08-25T12:00:00Z')
    const result = resolveWorkforceContext({
      timezone: 'Europe/Dublin',
      home,
      school,
      studySchedule: [{ dayOfWeek: 2, startsMinute: 0, endsMinute: 1440 }],
      leaves: [{
        kind: 'personal_leave',
        startsAt: '2026-08-25T00:00:00Z',
        endsAt: '2026-08-26T00:00:00Z',
      }],
    }, now)

    expect(result.state).toBe('personal_leave')
    expect(result.origin).toBeNull()
    expect(result.availableForScheduling).toBe(false)
  })

  it('uses requested capacity bands and never reports negative remaining capacity', () => {
    expect(capacityBand(9 * 60)).toBe('0-10')
    expect(capacityBand(15 * 60)).toBe('10-20')
    expect(capacityBand(22 * 60)).toBe('20-25')
    expect(capacityBand(27 * 60)).toBe('25-30')
    expect(capacityBand(30 * 60)).toBe('30+')
    expect(remainingCapacityMinutes(1800, 2000)).toBe(0)
  })
})
