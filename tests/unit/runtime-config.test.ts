import { afterEach, describe, expect, it, vi } from 'vitest'
import { getApplicationUrl, getSmtpConfig } from '../../src/lib/runtime-config'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('runtime configuration', () => {
  it('requires the public application URL in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXTAUTH_URL', '')
    expect(() => getApplicationUrl()).toThrow('NEXTAUTH_URL is required')
  })

  it('requires HTTPS for production links', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXTAUTH_URL', 'http://diamondshine.example')
    expect(() => getApplicationUrl()).toThrow('must use HTTPS')
  })

  it('normalizes the configured URL to its origin', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXTAUTH_URL', 'https://diamondshine.example/some/path')
    expect(getApplicationUrl()).toBe('https://diamondshine.example')
  })

  it('requires SMTP in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SMTP_HOST', '')
    expect(() => getSmtpConfig()).toThrow('SMTP_HOST is required')
  })

  it('rejects partial SMTP credentials', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('SMTP_USER', 'mailer')
    vi.stubEnv('SMTP_PASS', '')
    expect(() => getSmtpConfig()).toThrow('must be configured together')
  })
})
