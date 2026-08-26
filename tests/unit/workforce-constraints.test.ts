import { describe, expect, it } from 'vitest'
import { workforceConstraintForWindow } from '../../src/modules/scheduling/workforce-constraints'

describe('workforce scheduling constraints', () => {
  const profile = { studySchedules: [{ dayOfWeek: 1, startsMinute: 9*60, endsMinute: 14*60 }], leaves: [] as Array<{ kind: 'school_holiday'|'personal_leave'; startsAt: Date; endsAt: Date; reason?: string }> }
  it('blocks work overlapping school and allows work after school', () => {
    expect(workforceConstraintForWindow(profile, new Date('2026-08-24T09:00:00Z'), new Date('2026-08-24T11:00:00Z'), 'Europe/Dublin')?.kind).toBe('school')
    expect(workforceConstraintForWindow(profile, new Date('2026-08-24T15:00:00Z'), new Date('2026-08-24T16:00:00Z'), 'Europe/Dublin')).toBeNull()
  })
  it('school holiday disables the school constraint', () => {
    const holiday = { ...profile, leaves: [{ kind: 'school_holiday' as const, startsAt: new Date('2026-08-23T00:00:00Z'), endsAt: new Date('2026-08-25T00:00:00Z') }] }
    expect(workforceConstraintForWindow(holiday, new Date('2026-08-24T09:00:00Z'), new Date('2026-08-24T11:00:00Z'), 'Europe/Dublin')).toBeNull()
  })
  it('personal leave blocks the whole overlapping window', () => {
    const leave = { ...profile, leaves: [{ kind: 'personal_leave' as const, startsAt: new Date('2026-08-24T00:00:00Z'), endsAt: new Date('2026-08-25T00:00:00Z'), reason: 'Annual leave' }] }
    expect(workforceConstraintForWindow(leave, new Date('2026-08-24T15:00:00Z'), new Date('2026-08-24T16:00:00Z'), 'Europe/Dublin')).toMatchObject({ kind: 'personal_leave', reason: 'Annual leave' })
  })
})
