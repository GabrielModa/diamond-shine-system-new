import { describe, expect, it } from 'vitest'
import { assessDestructiveDatabaseGuard } from '../../src/lib/destructive-db-guard'

describe('destructive database guard', () => {
  it('allows a local development database', () => {
    expect(assessDestructiveDatabaseGuard({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/diamond_shine',
    }).allowed).toBe(true)
  })

  it('allows a clearly named remote integration target', () => {
    expect(assessDestructiveDatabaseGuard({
      DATABASE_URL: 'postgresql://u:p@db.internal:5432/diamond_shine_integration',
    }).allowed).toBe(true)
  })

  it('blocks production regardless of override-like environment variables', () => {
    const result = assessDestructiveDatabaseGuard({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@db.internal:5432/diamond_shine',
      ALLOW_DEMO_SEED: 'true',
    })
    expect(result.allowed).toBe(false)
  })

  it('blocks a production-looking remote database even when demo seeding was explicitly allowed', () => {
    const result = assessDestructiveDatabaseGuard({
      DATABASE_URL: 'postgresql://u:p@db.internal:5432/diamond_shine',
      ALLOW_DEMO_SEED: 'true',
    })
    expect(result.allowed).toBe(false)
  })
})
