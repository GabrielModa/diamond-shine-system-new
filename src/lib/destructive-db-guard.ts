export type DestructiveDatabaseGuardResult = {
  allowed: boolean
  reason: string
}

function databaseTarget(raw: string | undefined) {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) return null
    return {
      hostname: url.hostname.toLowerCase(),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase(),
      schema: (url.searchParams.get('schema') ?? 'public').toLowerCase(),
    }
  } catch {
    return null
  }
}

/**
 * Guard commands that destroy the current database before any seed guard can run.
 *
 * Unlike demo seeding, there is intentionally no environment-variable override
 * for a production-looking remote target. A force reset must point at localhost
 * or a database/schema whose name clearly identifies a non-production purpose.
 */
export function assessDestructiveDatabaseGuard(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DestructiveDatabaseGuardResult {
  if (env.NODE_ENV === 'production') {
    return { allowed: false, reason: 'Destructive database commands are disabled when NODE_ENV=production.' }
  }

  const target = databaseTarget(env.DATABASE_URL)
  if (!target) {
    return { allowed: false, reason: 'DATABASE_URL must be a valid PostgreSQL URL.' }
  }

  if (['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
    return { allowed: true, reason: 'Local PostgreSQL target.' }
  }

  const explicitlyDisposable = /(^|[_-])(test|tests|testing|integration|dev|development|staging|stage|sandbox)([_-]|$)/i
  if (explicitlyDisposable.test(target.database.replaceAll('-', '_'))
    || explicitlyDisposable.test(target.schema.replaceAll('-', '_'))) {
    return { allowed: true, reason: 'Remote database/schema name is explicitly non-production.' }
  }

  return {
    allowed: false,
    reason: 'Remote production-like database blocked. Force-reset commands require localhost or an explicitly test/dev/staging/sandbox database or schema.',
  }
}

export function assertDestructiveDatabaseSafe(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const result = assessDestructiveDatabaseGuard(env)
  if (!result.allowed) throw new Error(`DESTRUCTIVE_DB_BLOCKED: ${result.reason}`)
  return result
}
