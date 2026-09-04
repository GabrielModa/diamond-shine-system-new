/** Fail closed: CI and reset override flags never authorize deleting a dev database. */
export function assertIntegrationDatabaseSafe(raw = process.env.DATABASE_URL ?? '') {
  const refusal = () => new Error('Refusing destructive integration-test cleanup. Use a valid PostgreSQL URL with a dedicated test/integration database or schema; CI and reset overrides do not bypass this guard.')
  let url: URL
  try { url = new URL(raw) } catch { throw refusal() }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw refusal()
  let database: string
  try { database = decodeURIComponent(url.pathname.slice(1)) } catch { throw refusal() }
  const schema = url.searchParams.get('schema') ?? 'public'
  const dedicated = /(^|_)(test|tests|testing|integration)(_|$)/i
  if (!database || (!dedicated.test(database.replaceAll('-', '_')) && !dedicated.test(schema.replaceAll('-', '_')))) throw refusal()
}
