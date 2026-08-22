import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionToken, verifySessionToken } from '../../src/lib/session'

describe('signed sessions', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'a-long-test-secret-that-is-not-production'
    vi.useRealTimers()
  })

  it('round-trips a valid session', async () => {
    const token = await createSessionToken('admin@ds.ie', 'admin')
    await expect(verifySessionToken(token)).resolves.toMatchObject({ email: 'admin@ds.ie', role: 'admin' })
  })

  it('preserves revocable mobile session claims', async () => {
    const token = await createSessionToken('employee@ds.ie', 'employee', 'org-1', {
      sessionId: 'mobile-session-1',
      audience: 'mobile',
      ttlSeconds: 3600,
    })
    await expect(verifySessionToken(token)).resolves.toMatchObject({
      organizationId: 'org-1',
      sessionId: 'mobile-session-1',
      audience: 'mobile',
    })
  })

  it('rejects a tampered payload', async () => {
    const token = await createSessionToken('employee@ds.ie', 'employee')
    const [payload, signature] = token.split('.')
    const tampered = `${payload.slice(0, -1)}A.${signature}`
    await expect(verifySessionToken(tampered)).resolves.toBeNull()
  })

  it('rejects an expired session', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T00:00:00Z'))
    const token = await createSessionToken('admin@ds.ie', 'admin')
    vi.setSystemTime(new Date('2026-08-21T00:00:01Z'))
    await expect(verifySessionToken(token)).resolves.toBeNull()
  })
})
