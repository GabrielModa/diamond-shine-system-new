import { describe, expect, it } from 'vitest'
import { visitAttention } from '../../src/components/schedule/visit-attention'

const visit = { status: 'scheduled', requiredWorkers: 2, assignments: [{ status: 'notified', user: { id: 'a' } }] }
describe('visit attention', () => {
  it('retains every issue while choosing one persistent highest-priority tone', () => {
    expect(visitAttention(visit, true)).toEqual({ scheduling: true, conflicts: true, confirmation: true, any: true, tone: 'conflicts' })
    expect(visitAttention(visit, false).tone).toBe('scheduling')
    expect(visitAttention({ ...visit, requiredWorkers: 1 }, false).tone).toBe('confirmation')
  })
  it('does not count terminal or healthy visits as needing attention', () => {
    for (const status of ['completed', 'cancelled', 'missed']) expect(visitAttention({ ...visit, status }, true).any).toBe(false)
    expect(visitAttention({ ...visit, requiredWorkers: 1, assignments: [{ status: 'acknowledged', user: { id: 'a' } }] }, false).any).toBe(false)
  })
  it('scopes confirmation to the selected employee and ignores removed assignments', () => {
    const staffed = { ...visit, assignments: [...visit.assignments, { status: 'acknowledged', user: { id: 'b' } }] }
    expect(visitAttention(staffed, false, 'b').any).toBe(false)
    expect(visitAttention(staffed, false, 'a').confirmation).toBe(true)
    expect(visitAttention({ ...visit, assignments: [{ status: 'removed', user: { id: 'a' } }] }, false).confirmation).toBe(false)
  })
})
