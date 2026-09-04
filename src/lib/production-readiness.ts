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

function validHttpsOrigin(value: string | undefined) {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:'
      && url.pathname === '/'
      && !url.search
      && !url.hash
      && !url.username
      && !url.password
      && present(url.hostname)
  } catch { return false }
}

function evidenceStorageReady(env: NodeJS.ProcessEnv) {
  const provider = env.EVIDENCE_STORAGE_PROVIDER?.trim().toLowerCase()
  if (provider === 'supabase') {
    const secretKey = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    const bucket = env.SUPABASE_EVIDENCE_BUCKET?.trim() ?? ''
    return {
      ok: validHttpsOrigin(env.SUPABASE_URL) && present(secretKey) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(bucket),
      message: 'Supabase evidence storage requires HTTPS SUPABASE_URL, SUPABASE_SECRET_KEY (or temporary legacy SUPABASE_SERVICE_ROLE_KEY) and SUPABASE_EVIDENCE_BUCKET.',
    }
  }

  if (provider === 'filesystem') {
    const storageRoot = env.EVIDENCE_STORAGE_ROOT?.trim() ?? ''
    const persistentPath = present(storageRoot) && path.isAbsolute(storageRoot)
    const supportedHost = env.VERCEL !== '1'
    return {
      ok: persistentPath && supportedHost,
      message: 'Filesystem evidence storage requires an absolute persistent EVIDENCE_STORAGE_ROOT and cannot be used on Vercel.',
    }
  }

  return {
    ok: false,
    message: 'EVIDENCE_STORAGE_PROVIDER must be set to supabase or filesystem in production.',
  }
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

  add(checks, 'application-url', validHttpsOrigin(env.NEXTAUTH_URL), 'NEXTAUTH_URL must be an absolute HTTPS origin in production.')

  const workerSecret = env.NOTIFICATION_WORKER_SECRET?.trim() ?? ''
  add(checks, 'notification-worker-secret', present(workerSecret) && workerSecret.length >= 32 && workerSecret !== sessionSecret, 'NOTIFICATION_WORKER_SECRET must be an independent 32+ character secret.')

  const transport = env.EMAIL_TRANSPORT?.trim().toLowerCase()
  const smtpPort = Number(env.SMTP_PORT ?? '587')
  const smtpAuthPaired = Boolean(env.SMTP_USER?.trim()) === Boolean(env.SMTP_PASS)
  const smtpOk = transport !== 'json' && present(env.SMTP_HOST) && Number.isInteger(smtpPort) && smtpPort > 0 && smtpPort <= 65535 && smtpAuthPaired && /@/.test(env.SMTP_FROM ?? '')
  add(checks, 'email-delivery', smtpOk, 'Production email requires SMTP_HOST, valid SMTP_PORT, SMTP_FROM and paired SMTP_USER/SMTP_PASS credentials when authentication is used.')

  const evidenceStorage = evidenceStorageReady(env)
  add(checks, 'evidence-storage', evidenceStorage.ok, evidenceStorage.message)

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
