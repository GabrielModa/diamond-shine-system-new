import { describe, expect, it } from 'vitest'
import { hasCapability, roleHasCapability, scopeAllows } from '../../src/lib/permissions'

describe('capability authorization', () => {
  it('gives organization administrators every declared capability', () => {
    expect(roleHasCapability('organization_admin', 'organization.manage')).toBe(true)
    expect(roleHasCapability('organization_admin', 'payroll.release')).toBe(true)
  })

  it('keeps employee permissions focused on assigned field work', () => {
    expect(roleHasCapability('employee', 'visits.execute')).toBe(true)
    expect(roleHasCapability('employee', 'supplies.request')).toBe(true)
    expect(roleHasCapability('employee', 'schedule.manage')).toBe(false)
    expect(roleHasCapability('employee', 'finance.read')).toBe(false)
  })

  it('supports explicit scoped grants without widening the base role', () => {
    expect(hasCapability({
      role: 'viewer',
      capability: 'visits.review',
      requestedScope: { type: 'site', id: 'site-1' },
      grants: [{ capability: 'visits.review', scopeType: 'site', scopeId: 'site-1' }],
    })).toBe(true)

    expect(hasCapability({
      role: 'viewer',
      capability: 'visits.review',
      requestedScope: { type: 'site', id: 'site-2' },
      grants: [{ capability: 'visits.review', scopeType: 'site', scopeId: 'site-1' }],
    })).toBe(false)
  })

  it('treats organization scope as covering narrower scopes', () => {
    expect(scopeAllows(
      { type: 'organization' },
      { type: 'site', id: 'site-1' }
    )).toBe(true)
  })
})
