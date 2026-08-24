import { describe, expect, it } from 'vitest'
import { hashAuthToken } from '../../src/lib/auth-tokens'

describe('auth token hashing', () => {
  it('is deterministic without storing the raw token', () => {
    const raw = 'one-time-secret-token'
    const hash = hashAuthToken(raw)
    expect(hash).toHaveLength(64)
    expect(hash).not.toContain(raw)
    expect(hashAuthToken(raw)).toBe(hash)
  })

  it('produces a different hash for a different token', () => {
    expect(hashAuthToken('token-a')).not.toBe(hashAuthToken('token-b'))
  })
})
