import { describe, expect, it } from 'vitest'
import { assessDemoSeedGuard } from '../../src/lib/demo-seed-guard'

describe('demo seed guard', () => {
  it('allows the local development database', () => {
    expect(assessDemoSeedGuard({ DATABASE_URL: 'postgresql://u:p@localhost:5432/diamond_shine' }).allowed).toBe(true)
  })

  it('allows an explicitly named remote test database', () => {
    expect(assessDemoSeedGuard({ DATABASE_URL: 'postgresql://u:p@db.internal:5432/diamond_shine_test' }).allowed).toBe(true)
  })

  it('blocks production regardless of an override', () => {
    const result = assessDemoSeedGuard({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db.internal:5432/diamond_shine', ALLOW_DEMO_SEED: 'true' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('NODE_ENV=production')
  })

  it('blocks a remote production-like database by default', () => {
    expect(assessDemoSeedGuard({ DATABASE_URL: 'postgresql://u:p@db.internal:5432/diamond_shine' }).allowed).toBe(false)
  })

  it('requires an explicit override for a remote development target with a production-like name', () => {
    expect(assessDemoSeedGuard({ DATABASE_URL: 'postgresql://u:p@db.internal:5432/diamond_shine', ALLOW_DEMO_SEED: 'true' }).allowed).toBe(true)
  })
})
