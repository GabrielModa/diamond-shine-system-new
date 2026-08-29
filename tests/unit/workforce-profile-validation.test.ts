import { describe, expect, it } from 'vitest'
import { isValidPhoneNumber, normalizePhoneNumber, weeklyWindowError } from '../../src/modules/workforce/profile-validation'

describe('workforce profile validation', () => {
  it('normalizes Irish local phones and accepts international E.164 numbers', () => {
    expect(normalizePhoneNumber('087 123 4567')).toBe('+353871234567')
    expect(isValidPhoneNumber('+353 87 123 4567')).toBe(true)
    expect(isValidPhoneNumber('abc')).toBe(false)
  })

  it('rejects backwards and overlapping weekly windows', () => {
    expect(weeklyWindowError([{ dayOfWeek: 1, startsMinute: 540, endsMinute: 480 }], 'Availability')).toContain('Until')
    expect(weeklyWindowError([
      { dayOfWeek: 1, startsMinute: 540, endsMinute: 720 },
      { dayOfWeek: 1, startsMinute: 660, endsMinute: 780 },
    ], 'Availability')).toContain('overlapping')
    expect(weeklyWindowError([
      { dayOfWeek: 1, startsMinute: 540, endsMinute: 720 },
      { dayOfWeek: 2, startsMinute: 540, endsMinute: 720 },
    ], 'Availability')).toBeNull()
  })
})
