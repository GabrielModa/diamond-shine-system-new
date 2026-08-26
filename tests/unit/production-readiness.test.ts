import { describe, expect, it } from 'vitest'
import { assessProductionReadiness } from '../../src/lib/production-readiness'

const readyEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://diamond:secret@db.internal:5432/diamond_shine?sslmode=require',
  SESSION_SECRET: 'session-secret-that-is-definitely-long-enough-123',
  NEXTAUTH_URL: 'https://ops.diamondshine.ie',
  NOTIFICATION_WORKER_SECRET: 'worker-secret-that-is-independent-and-long-456',
  SMTP_HOST: 'smtp.mail.diamondshine.ie',
  SMTP_PORT: '587',
  SMTP_USER: 'mailer',
  SMTP_PASS: 'secret',
  SMTP_FROM: 'Diamond Shine <noreply@diamondshine.ie>',
  EVIDENCE_STORAGE_ROOT: '/var/lib/diamond-shine/evidence',
  GOOGLE_MAPS_API_KEY: 'google-key-present',
  EXPO_PUSH_ACCESS_TOKEN: 'expo-access-token-present',
} satisfies NodeJS.ProcessEnv

describe('production readiness', () => {
  it('does not block normal development mode', () => {
    expect(assessProductionReadiness({ NODE_ENV: 'development' }).ready).toBe(true)
  })

  it('accepts a complete production configuration without exposing secret values', () => {
    const result = assessProductionReadiness(readyEnv)
    expect(result.ready).toBe(true)
    expect(JSON.stringify(result)).not.toContain(readyEnv.SESSION_SECRET)
    expect(JSON.stringify(result)).not.toContain(readyEnv.NOTIFICATION_WORKER_SECRET)
  })

  it('rejects missing or placeholder production secrets', () => {
    const result = assessProductionReadiness({ ...readyEnv, SESSION_SECRET: 'replace-with-at-least-32-random-characters' })
    expect(result.ready).toBe(false)
    expect(result.checks.find((check) => check.key === 'session-secret')?.ok).toBe(false)
  })

  it('requires HTTPS for the public production origin', () => {
    const result = assessProductionReadiness({ ...readyEnv, NEXTAUTH_URL: 'http://ops.diamondshine.ie' })
    expect(result.ready).toBe(false)
    expect(result.checks.find((check) => check.key === 'application-url')?.ok).toBe(false)
  })

  it('requires an explicit absolute persistent evidence path', () => {
    const result = assessProductionReadiness({ ...readyEnv, EVIDENCE_STORAGE_ROOT: '.data/uploads' })
    expect(result.ready).toBe(false)
    expect(result.checks.find((check) => check.key === 'evidence-storage')?.ok).toBe(false)
  })

  it('requires the notification worker secret to be independent from the session secret', () => {
    const result = assessProductionReadiness({ ...readyEnv, NOTIFICATION_WORKER_SECRET: readyEnv.SESSION_SECRET })
    expect(result.ready).toBe(false)
    expect(result.checks.find((check) => check.key === 'notification-worker-secret')?.ok).toBe(false)
  })
})
