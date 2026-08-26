export type PilotReadinessCheck = {
  key: string
  ok: boolean
  message: string
}

export type PilotReadiness = {
  ready: boolean
  checks: PilotReadinessCheck[]
}

function usableEmail(value: string | undefined) {
  const normalized = value?.trim() ?? ''
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)
}

function usablePassword(value: string | undefined) {
  const normalized = value ?? ''
  return normalized.length >= 12 && !/(password123|replace-with|change-me|placeholder|example)/i.test(normalized)
}

function add(checks: PilotReadinessCheck[], key: string, ok: boolean, message: string) {
  checks.push({ key, ok, message })
}

export function assessPilotReadiness(env: Readonly<Record<string, string | undefined>> = process.env): PilotReadiness {
  const checks: PilotReadinessCheck[] = []
  let originOk = false
  try {
    const url = new URL(env.NEXTAUTH_URL ?? '')
    originOk = url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash
  } catch { originOk = false }
  add(checks, 'pilot-origin', originOk, 'NEXTAUTH_URL must be the production HTTPS origin.')

  const adminEmail = env.PILOT_ADMIN_EMAIL?.trim().toLowerCase() ?? ''
  const employeeEmail = env.PILOT_EMPLOYEE_EMAIL?.trim().toLowerCase() ?? ''
  add(checks, 'pilot-admin', usableEmail(adminEmail) && usablePassword(env.PILOT_ADMIN_PASSWORD), 'Dedicated pilot admin credentials are required.')
  add(checks, 'pilot-employee', usableEmail(employeeEmail) && usablePassword(env.PILOT_EMPLOYEE_PASSWORD), 'Dedicated pilot employee credentials are required.')
  add(checks, 'pilot-account-separation', Boolean(adminEmail && employeeEmail && adminEmail !== employeeEmail), 'Pilot admin and employee must be different accounts.')

  return { ready: checks.every((check) => check.ok), checks }
}
