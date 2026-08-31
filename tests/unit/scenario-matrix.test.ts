import { describe, expect, it } from 'vitest'
import { DEMO_EMPLOYEE_SCENARIOS, DEMO_SITE_SCENARIOS } from '../../src/lib/demo-scenarios'
import { resolveRouteOrigin } from '../../src/lib/workforce-route-origin'

describe('demo scenario matrix', () => {
  it('covers the workforce contexts required by the product demo', () => {
    const tags = new Set(DEMO_EMPLOYEE_SCENARIOS.flatMap((scenario) => scenario.tags))
    for (const required of [
      'no-school', 'school-morning', 'school-afternoon', 'school-evening',
      'school-alternate-days', 'school-holiday', 'personal-leave',
      'zero-hours', '10h-worked', '20h-worked', '30h-worked',
      'over-target', 'always-school-test',
    ]) {
      expect(tags.has(required), `missing demo tag ${required}`).toBe(true)
    }
    expect(DEMO_EMPLOYEE_SCENARIOS.length).toBeGreaterThanOrEqual(15)
  })

  it('covers different client/site operating windows', () => {
    const tags = new Set(DEMO_SITE_SCENARIOS.flatMap((scenario) => scenario.tags))
    for (const required of ['very-early', 'early-morning', 'daytime', 'afternoon', 'evening', 'late-evening', 'night']) {
      expect(tags.has(required), `missing site tag ${required}`).toBe(true)
    }
    expect(tags.has('needs-staff')).toBe(true)
    expect(tags.has('covered')).toBe(true)
    expect(DEMO_SITE_SCENARIOS.length).toBeGreaterThanOrEqual(10)
    expect(new Set(DEMO_SITE_SCENARIOS.map((scenario) => scenario.client)).size).toBe(DEMO_SITE_SCENARIOS.length)
  })
})

describe('route origin override', () => {
  const home = { kind:'home' as const, label:'Home', address:'Clontarf', latitude:53.36, longitude:-6.19 }
  const school = { kind:'school' as const, label:'Trinity', address:'Dublin 2', latitude:53.34, longitude:-6.25 }

  it('keeps the calculated context in Auto', () => {
    expect(resolveRouteOrigin('auto', school, home, school)).toBe(school)
  })
  it('can preview a route from Home without changing the stored schedule', () => {
    expect(resolveRouteOrigin('home', school, home, school)).toBe(home)
  })
  it('can preview from School and safely falls back when school is absent', () => {
    expect(resolveRouteOrigin('school', home, home, school)).toBe(school)
    expect(resolveRouteOrigin('school', home, home, null)).toBe(home)
  })
})
