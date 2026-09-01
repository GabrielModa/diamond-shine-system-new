import { describe, expect, it } from 'vitest'
import {
  workforceConstraintForWindow,
  workforceConstraintWindows,
  type WorkforceConstraintProfile,
} from '../../src/modules/scheduling/workforce-constraints'

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart
}

function expandedBlocks(profile: WorkforceConstraintProfile, start: Date, end: Date) {
  return workforceConstraintWindows(
    profile,
    new Date('2026-08-24T00:00:00.000Z'),
    new Date('2026-08-25T00:00:00.000Z'),
    'Europe/Dublin',
  ).some((window) => overlaps(start, end, window.startsAt, window.endsAt))
}

describe('workforceConstraintWindows', () => {
  it('matches direct validation for school, recurring unavailability and personal leave', () => {
    const profile: WorkforceConstraintProfile = {
      studySchedules: [{ dayOfWeek: 1, startsMinute: 9 * 60, endsMinute: 14 * 60 }],
      recurringUnavailability: [{ dayOfWeek: 1, startsMinute: 18 * 60, endsMinute: 22 * 60, reason: 'Other job' }],
      leaves: [{
        kind: 'personal_leave',
        startsAt: new Date('2026-08-24T14:00:00.000Z'),
        endsAt: new Date('2026-08-24T15:00:00.000Z'),
        reason: 'Appointment',
      }],
    }

    const probes = [
      [new Date('2026-08-24T08:30:00.000Z'), new Date('2026-08-24T09:30:00.000Z')],
      [new Date('2026-08-24T14:15:00.000Z'), new Date('2026-08-24T14:45:00.000Z')],
      [new Date('2026-08-24T17:30:00.000Z'), new Date('2026-08-24T18:30:00.000Z')],
      [new Date('2026-08-24T15:30:00.000Z'), new Date('2026-08-24T16:30:00.000Z')],
    ] as const

    for (const [start, end] of probes) {
      expect(expandedBlocks(profile, start, end)).toBe(Boolean(
        workforceConstraintForWindow(profile, start, end, 'Europe/Dublin'),
      ))
    }
  })

  it('removes only the school portion covered by a partial school holiday', () => {
    const profile: WorkforceConstraintProfile = {
      studySchedules: [{ dayOfWeek: 1, startsMinute: 9 * 60, endsMinute: 16 * 60 }],
      recurringUnavailability: [],
      leaves: [{
        kind: 'school_holiday',
        startsAt: new Date('2026-08-24T12:00:00.000Z'),
        endsAt: new Date('2026-08-24T16:00:00.000Z'),
        reason: 'Afternoon closure',
      }],
    }

    const windows = workforceConstraintWindows(
      profile,
      new Date('2026-08-24T00:00:00.000Z'),
      new Date('2026-08-25T00:00:00.000Z'),
      'Europe/Dublin',
    ).filter((window) => window.kind === 'school')

    expect(windows).toHaveLength(1)
    expect(windows[0].startsAt.toISOString()).toBe('2026-08-24T08:00:00.000Z')
    expect(windows[0].endsAt.toISOString()).toBe('2026-08-24T12:00:00.000Z')

    expect(workforceConstraintForWindow(
      profile,
      new Date('2026-08-24T09:00:00.000Z'),
      new Date('2026-08-24T10:00:00.000Z'),
      'Europe/Dublin',
    )?.kind).toBe('school')

    expect(workforceConstraintForWindow(
      profile,
      new Date('2026-08-24T12:30:00.000Z'),
      new Date('2026-08-24T13:30:00.000Z'),
      'Europe/Dublin',
    )).toBeNull()
  })
})
