import path from 'node:path'

type ReadinessLevel = 'required' | 'recommended'

export type ProductionReadinessCheck = {
  key: string
  ok: boolean
  level: ReadinessLevel
  message: string
}

export type ProductionReadiness = {
  ready: boolean
  strict: boolean
  checks: ProductionReadinessCheck[]
}

function present(value: string | undefined) {
  const normalized = value?.trim() ?? ''
  return Boolean(normalized) && !/replace-with|change-me|example|placeholder/i.test(normalized)
}

function add(checks: ProductionReadinessCheck[], key: string, ok: boolean, message: string, level: ReadinessLevel = 'required') {
  checks.push({ key, ok, level, message })
}

export function assessProductionReadiness(env: NodeJS.ProcessEnv = process.env): ProductionReadiness {
  const strict = env.NODE_ENV === 'production' || env.PRODUCTION_READINESS_STRICT === 'true'
  if (!strict) return { ready: true, strict: false, checks: [] }

  const checks: ProductionReadinessCheck[] = []

  let databaseOk = false
  try {
    const database = new URL(env.DATABASE_URL ?? '')
    databaseOk = ['postgres:', 'postgresql:'].includes(database.protocol) && present(database.hostname) && present(database.pathname.replace(/^\//, ''))
  } catch { databaseOk = false }
  add(checks, 'database', databaseOk, 'DATABASE_URL must be a non-placeholder PostgreSQL connection string.')

  const sessionSecret = env.SESSION_SECRET?.trim() ?? ''
  add(checks, 'session-secret', present(sessionSecret) && sessionSecret.length >= 32, 'SESSION_SECRET must contain at least 32 non-placeholder characters.')

  let applicationUrlOk = false
  try { applicationUrlOk = new URL(env.NEXTAUTH_URL ?? '').protocol === 'https:' } catch { applicationUrlOk = false }
  add(checks, 'application-url', applicationUrlOk, 'NEXTAUTH_URL must be an absolute HTTPS origin in production.')

  const workerSecret = env.NOTIFICATION_WORKER_SECRET?.trim() ?? ''
  add(checks, 'notification-worker-secret', present(workerSecret) && workerSecret.length >= 32 && workerSecret !== sessionSecret, 'NOTIFICATION_WORKER_SECRET must be an independent 32+ character secret.')

  const transport = env.EMAIL_TRANSPORT?.trim().toLowerCase()
  const smtpPort = Number(env.SMTP_PORT ?? '587')
  const smtpAuthPaired = Boolean(env.SMTP_USER?.trim()) === Boolean(env.SMTP_PASS)
  const smtpOk = transport !== 'json' && present(env.SMTP_HOST) && Number.isInteger(smtpPort) && smtpPort > 0 && smtpPort <= 65535 && smtpAuthPaired && /@/.test(env.SMTP_FROM ?? '')
  add(checks, 'email-delivery', smtpOk, 'Production email requires SMTP_HOST, valid SMTP_PORT, SMTP_FROM and paired SMTP_USER/SMTP_PASS credentials when authentication is used.')

  const storageRoot = env.EVIDENCE_STORAGE_ROOT?.trim() ?? ''
  add(checks, 'evidence-storage', present(storageRoot) && path.isAbsolute(storageRoot), 'EVIDENCE_STORAGE_ROOT must be an explicit absolute path mounted on persistent storage.')

  add(checks, 'google-routes', present(env.GOOGLE_MAPS_API_KEY), 'GOOGLE_MAPS_API_KEY must be configured for route planning.')
  add(checks, 'push-delivery', present(env.EXPO_PUSH_ACCESS_TOKEN), 'EXPO_PUSH_ACCESS_TOKEN should be configured so operational push delivery uses an authenticated Expo project.')

  const required = checks.filter((check) => check.level === 'required')
  return { ready: required.every((check) => check.ok), strict: true, checks }
}

export function assertProductionReadiness(env: NodeJS.ProcessEnv = process.env) {
  const result = assessProductionReadiness(env)
  if (!result.ready) {
    const failures = result.checks.filter((check) => check.level === 'required' && !check.ok).map((check) => check.key)
    throw new Error(`Production configuration is not ready: ${failures.join(', ')}`)
  }
  return result
}
