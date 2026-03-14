import { describe, it, expect } from 'vitest'
import {
  calculateOverall,
  getCategoryLabel,
  isValidRating,
  checkPageAccess,
  getAllowedPages,
  formatDublinDate,
} from '../../src/lib/business-logic'

describe('calculateOverall', () => {
  it('returns 5.0 for four 5.0 values', () => {
    expect(calculateOverall(5.0, 5.0, 5.0, 5.0)).toBe(5.0)
  })
  it('returns 1.0 for four 1.0 values', () => {
    expect(calculateOverall(1.0, 1.0, 1.0, 1.0)).toBe(1.0)
  })
  it('returns 4.0 for (3.0, 4.0, 5.0, 4.0)', () => {
    expect(calculateOverall(3.0, 4.0, 5.0, 4.0)).toBe(4.0)
  })
  it('returns 3.75 for (3.0, 3.5, 4.0, 4.5)', () => {
    expect(calculateOverall(3.0, 3.5, 4.0, 4.5)).toBe(3.75)
  })
  it('returns 4.5 for four 4.5 values', () => {
    expect(calculateOverall(4.5, 4.5, 4.5, 4.5)).toBe(4.5)
  })
})

describe('getCategoryLabel', () => {
  it('returns Excellent for 5.0', () => expect(getCategoryLabel(5.0)).toBe('Excellent'))
  it('returns Excellent for exactly 4.6', () => expect(getCategoryLabel(4.6)).toBe('Excellent'))
  it('returns Very Good for 4.59', () => expect(getCategoryLabel(4.59)).toBe('Very Good'))
  it('returns Very Good for exactly 4.0', () => expect(getCategoryLabel(4.0)).toBe('Very Good'))
  it('returns Good for 3.99', () => expect(getCategoryLabel(3.99)).toBe('Good'))
  it('returns Good for exactly 3.0', () => expect(getCategoryLabel(3.0)).toBe('Good'))
  it('returns Fair for 2.99', () => expect(getCategoryLabel(2.99)).toBe('Fair'))
  it('returns Fair for exactly 2.0', () => expect(getCategoryLabel(2.0)).toBe('Fair'))
  it('returns Poor for 1.99', () => expect(getCategoryLabel(1.99)).toBe('Poor'))
  it('returns Poor for 1.0', () => expect(getCategoryLabel(1.0)).toBe('Poor'))
})

describe('isValidRating', () => {
  it('accepts 1.0', () => expect(isValidRating(1.0)).toBe(true))
  it('accepts 1.5', () => expect(isValidRating(1.5)).toBe(true))
  it('accepts 2.0', () => expect(isValidRating(2.0)).toBe(true))
  it('accepts 3.5', () => expect(isValidRating(3.5)).toBe(true))
  it('accepts 4.0', () => expect(isValidRating(4.0)).toBe(true))
  it('accepts 5.0', () => expect(isValidRating(5.0)).toBe(true))
  it('rejects 0.5', () => expect(isValidRating(0.5)).toBe(false))
  it('rejects 0', () => expect(isValidRating(0)).toBe(false))
  it('rejects -1', () => expect(isValidRating(-1)).toBe(false))
  it('rejects 5.5', () => expect(isValidRating(5.5)).toBe(false))
  it('rejects 6.0', () => expect(isValidRating(6.0)).toBe(false))
  it('rejects 1.3', () => expect(isValidRating(1.3)).toBe(false))
  it('rejects 2.7', () => expect(isValidRating(2.7)).toBe(false))
  it('rejects 4.7', () => expect(isValidRating(4.7)).toBe(false))
})

describe('checkPageAccess', () => {
  describe('admin', () => {
    it('can access home', () => expect(checkPageAccess('admin', 'home')).toBe(true))
    it('can access supplies', () => expect(checkPageAccess('admin', 'supplies')).toBe(true))
    it('can access feedback', () => expect(checkPageAccess('admin', 'feedback')).toBe(true))
    it('can access dashboard', () => expect(checkPageAccess('admin', 'dashboard')).toBe(true))
  })
  describe('supervisor', () => {
    it('can access home', () => expect(checkPageAccess('supervisor', 'home')).toBe(true))
    it('can access supplies', () => expect(checkPageAccess('supervisor', 'supplies')).toBe(true))
    it('can access feedback', () => expect(checkPageAccess('supervisor', 'feedback')).toBe(true))
    it('cannot access dashboard', () => expect(checkPageAccess('supervisor', 'dashboard')).toBe(false))
  })
  describe('employee', () => {
    it('can access home', () => expect(checkPageAccess('employee', 'home')).toBe(true))
    it('can access supplies', () => expect(checkPageAccess('employee', 'supplies')).toBe(true))
    it('cannot access feedback', () => expect(checkPageAccess('employee', 'feedback')).toBe(false))
    it('cannot access dashboard', () => expect(checkPageAccess('employee', 'dashboard')).toBe(false))
  })
  describe('viewer', () => {
    it('can access home', () => expect(checkPageAccess('viewer', 'home')).toBe(true))
    it('cannot access supplies', () => expect(checkPageAccess('viewer', 'supplies')).toBe(false))
    it('cannot access feedback', () => expect(checkPageAccess('viewer', 'feedback')).toBe(false))
    it('cannot access dashboard', () => expect(checkPageAccess('viewer', 'dashboard')).toBe(false))
  })
})

describe('getAllowedPages', () => {
  it('admin gets all 4 pages', () => {
    expect(getAllowedPages('admin').sort()).toEqual(['dashboard', 'feedback', 'home', 'supplies'])
  })
  it('supervisor gets 3 pages (no dashboard)', () => {
    expect(getAllowedPages('supervisor').sort()).toEqual(['feedback', 'home', 'supplies'])
  })
  it('employee gets 2 pages (home + supplies)', () => {
    expect(getAllowedPages('employee').sort()).toEqual(['home', 'supplies'])
  })
  it('viewer gets only home', () => {
    expect(getAllowedPages('viewer')).toEqual(['home'])
  })
  it('unknown role gets empty array', () => {
    expect(getAllowedPages('unknown' as never)).toEqual([])
  })
})

describe('formatDublinDate', () => {
  it('returns a non-empty string', () => {
    expect(formatDublinDate(new Date())).toBeTruthy()
  })
  it('includes the correct day/month/year for 2024-01-15T12:00:00Z', () => {
    expect(formatDublinDate(new Date('2024-01-15T12:00:00Z'))).toMatch(/15\/01\/2024/)
  })
  it('includes the correct time for 2024-01-15T14:30:00Z', () => {
    expect(formatDublinDate(new Date('2024-01-15T14:30:00Z'))).toMatch(/14:30/)
  })
})
