export type DemoSeedGuardResult = {
  allowed: boolean
  reason: string
}

function databaseIdentity(raw: string | undefined) {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return null
    return {
      hostname: url.hostname.toLowerCase(),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase(),
    }
  } catch {
    return null
  }
}

export function assessDemoSeedGuard(env: Readonly<Record<string, string | undefined>> = process.env): DemoSeedGuardResult {
  if (env.NODE_ENV === 'production') {
    return { allowed: false, reason: 'Demo seed commands are disabled when NODE_ENV=production.' }
  }

  const database = databaseIdentity(env.DATABASE_URL)
  if (!database) return { allowed: false, reason: 'DATABASE_URL must be a PostgreSQL URL before demo data can be seeded.' }

  const localHost = ['localhost', '127.0.0.1', '::1'].includes(database.hostname)
  if (localHost) return { allowed: true, reason: 'Local PostgreSQL target.' }

  const nonProductionName = /(?:^|[_-])(test|testing|dev|development|staging|stage|sandbox)(?:[_-]|$)/i.test(database.database)
  if (nonProductionName) return { allowed: true, reason: 'Database name is explicitly non-production.' }

  if (env.ALLOW_DEMO_SEED === 'true') {
    return { allowed: true, reason: 'Explicit ALLOW_DEMO_SEED=true override outside production.' }
  }

  return {
    allowed: false,
    reason: 'Remote production-like database blocked. Use a clearly non-production database or set ALLOW_DEMO_SEED=true deliberately.',
  }
}

export function assertDemoSeedAllowed(env: Readonly<Record<string, string | undefined>> = process.env) {
  const result = assessDemoSeedGuard(env)
  if (!result.allowed) throw new Error(`DEMO_SEED_BLOCKED: ${result.reason}`)
  return result
}
