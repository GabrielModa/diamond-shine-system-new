import { describe, expect, it } from 'vitest'
import { workforceConstraintForWindow } from '../../src/modules/scheduling/workforce-constraints'

describe('recurring workforce constraints', () => {
  it('blocks a recurring weekly window and rejects backwards windows at input validation layer', () => {
    const conflict = workforceConstraintForWindow({
      studySchedules: [],
      recurringUnavailability: [{ dayOfWeek: 1, startsMinute: 9 * 60, endsMinute: 12 * 60 + 30, reason: 'Other commitment' }],
      leaves: [],
    }, new Date('2026-08-31T09:30:00.000Z'), new Date('2026-08-31T10:30:00.000Z'), 'UTC')

    expect(conflict?.kind).toBe('recurring_unavailability')
    expect(conflict?.reason).toBe('Other commitment')
  })

  it('checks every recurring block on the same day', () => {
    const conflict = workforceConstraintForWindow({
      studySchedules: [],
      recurringUnavailability: [
        { dayOfWeek: 1, startsMinute: 8 * 60, endsMinute: 9 * 60, reason: 'Early block' },
        { dayOfWeek: 1, startsMinute: 18 * 60, endsMinute: 22 * 60, reason: 'Other job' },
      ],
      leaves: [],
    }, new Date('2026-08-31T19:00:00.000Z'), new Date('2026-08-31T20:00:00.000Z'), 'UTC')

    expect(conflict?.kind).toBe('recurring_unavailability')
    expect(conflict?.reason).toBe('Other job')
  })

  it('treats active study hours as a scheduling constraint', () => {
    const conflict = workforceConstraintForWindow({
      studySchedules: [{ dayOfWeek: 1, startsMinute: 9 * 60, endsMinute: 12 * 60 + 30 }],
      recurringUnavailability: [],
      leaves: [],
    }, new Date('2026-08-31T10:00:00.000Z'), new Date('2026-08-31T11:00:00.000Z'), 'UTC')

    expect(conflict?.kind).toBe('school')
  })
})
