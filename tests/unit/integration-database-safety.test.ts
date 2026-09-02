import { describe, expect, it, vi, afterEach } from 'vitest'
import { assertIntegrationDatabaseSafe } from '../integration/database-safety'

afterEach(() => vi.unstubAllEnvs())
describe('integration database isolation', () => {
  it.each(['', 'test', 'not a url integration', 'file:test', 'postgresql://localhost/dev', 'postgresql://localhost/contest', 'postgresql://localhost/dev?password=test'])('rejects unsafe target %s', (url) => {
    expect(() => assertIntegrationDatabaseSafe(url)).toThrow('Refusing destructive')
  })
  it.each(['postgresql://localhost/diamond_test', 'postgres://localhost/integration_db', 'postgresql://localhost/dev?schema=integration_suite'])('allows dedicated target %s', (url) => {
    expect(() => assertIntegrationDatabaseSafe(url)).not.toThrow()
  })
  it('CI and override cannot authorize the development database', () => {
    vi.stubEnv('CI', 'true')
    vi.stubEnv('ALLOW_INTEGRATION_DB_RESET', 'true')
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/diamond_demo')
    expect(() => assertIntegrationDatabaseSafe()).toThrow('Refusing destructive')
  })
})
