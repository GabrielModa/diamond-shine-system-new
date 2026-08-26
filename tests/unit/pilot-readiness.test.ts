import { describe, expect, it } from 'vitest'
import { assessPilotReadiness } from '../../src/lib/pilot-readiness'

const valid = {
  NEXTAUTH_URL: 'https://app.diamondshine.ie/',
  PILOT_ADMIN_EMAIL: 'pilot-admin@diamondshine.ie',
  PILOT_ADMIN_PASSWORD: 'AdminPilot-Only-2026!',
  PILOT_EMPLOYEE_EMAIL: 'pilot-cleaner@diamondshine.ie',
  PILOT_EMPLOYEE_PASSWORD: 'CleanerPilot-Only-2026!',
}

describe('pilot readiness', () => {
  it('accepts separate production pilot accounts without exposing passwords', () => {
    const result = assessPilotReadiness(valid)
    expect(result.ready).toBe(true)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(valid.PILOT_ADMIN_PASSWORD)
    expect(serialized).not.toContain(valid.PILOT_EMPLOYEE_PASSWORD)
  })

  it('requires HTTPS', () => {
    expect(assessPilotReadiness({ ...valid, NEXTAUTH_URL: 'http://app.diamondshine.ie/' }).ready).toBe(false)
  })

  it('rejects demo passwords', () => {
    expect(assessPilotReadiness({ ...valid, PILOT_EMPLOYEE_PASSWORD: 'password123' }).ready).toBe(false)
  })

  it('requires separate role accounts', () => {
    expect(assessPilotReadiness({ ...valid, PILOT_EMPLOYEE_EMAIL: valid.PILOT_ADMIN_EMAIL }).ready).toBe(false)
  })
})
