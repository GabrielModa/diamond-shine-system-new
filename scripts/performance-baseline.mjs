const base = (process.env.PERFORMANCE_BASE_URL || process.env.NEXTAUTH_URL || '').trim().replace(/\/$/, '')
if (!base) {
  console.error('Set PERFORMANCE_BASE_URL or NEXTAUTH_URL to the deployed application origin.')
  process.exit(1)
}

let origin
try {
  origin = new URL(base)
} catch {
  console.error('Performance base URL is invalid.')
  process.exit(1)
}
if (!['http:', 'https:'].includes(origin.protocol)) {
  console.error('Performance base URL must use HTTP or HTTPS.')
  process.exit(1)
}

const requestedSamples = Number(process.env.PERFORMANCE_SAMPLES ?? '8')
const samples = Number.isInteger(requestedSamples) ? Math.min(50, Math.max(1, requestedSamples)) : 8
const requestedConcurrency = Number(process.env.PERFORMANCE_CONCURRENCY ?? '1')
const concurrency = Number.isInteger(requestedConcurrency) ? Math.min(20, Math.max(1, requestedConcurrency)) : 1

function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  return Math.round(sorted[index] * 10) / 10
}

async function one(path, headers = {}) {
  const startedAt = performance.now()
  const response = await fetch(new URL(path, origin), {
    cache: 'no-store',
    headers,
    signal: AbortSignal.timeout(15_000),
  })
  const bytes = (await response.arrayBuffer()).byteLength
  return {
    ok: response.ok,
    status: response.status,
    durationMs: performance.now() - startedAt,
    bytes,
  }
}

async function measure(name, path, headers = {}) {
  const results = []
  let remaining = samples
  while (remaining > 0) {
    const batchSize = Math.min(concurrency, remaining)
    const batch = await Promise.all(Array.from({ length: batchSize }, () => one(path, headers).catch(() => ({
      ok: false,
      status: 0,
      durationMs: 15_000,
      bytes: 0,
    }))))
    results.push(...batch)
    remaining -= batchSize
  }
  const successful = results.filter((result) => result.ok)
  const durations = successful.map((result) => result.durationMs)
  const payloads = successful.map((result) => result.bytes)
  return {
    name,
    path,
    successes: successful.length,
    failures: results.length - successful.length,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: durations.length ? Math.round(Math.max(...durations) * 10) / 10 : null,
    payloadP50Bytes: percentile(payloads, 50),
    statuses: [...new Set(results.map((result) => result.status))].sort((a, b) => a - b),
  }
}

async function login() {
  const email = process.env.PERFORMANCE_EMAIL?.trim()
  const password = process.env.PERFORMANCE_PASSWORD ?? ''
  if (!email || !password) return null
  const response = await fetch(new URL('/api/auth/login', origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Performance login failed with HTTP ${response.status}.`)
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('Performance login did not return a session cookie.')
  return { Cookie: setCookie.split(';', 1)[0] }
}

const rows = []
rows.push(await measure('health', '/api/health'))

const authHeaders = await login()
if (authHeaders) {
  const now = new Date()
  const dayFrom = new Date(now); dayFrom.setHours(0, 0, 0, 0)
  const dayTo = new Date(dayFrom); dayTo.setDate(dayTo.getDate() + 1)
  const scheduleFrom = new Date(now.getTime() - 7 * 86_400_000)
  const scheduleTo = new Date(now.getTime() + 90 * 86_400_000)
  const authenticatedReads = [
    ['home summary', '/api/home-summary'],
    ['command centre', `/api/command-centre?from=${encodeURIComponent(dayFrom.toISOString())}&to=${encodeURIComponent(dayTo.toISOString())}`],
    ['schedule bootstrap', `/api/schedule/bootstrap?from=${encodeURIComponent(scheduleFrom.toISOString())}&to=${encodeURIComponent(scheduleTo.toISOString())}`],
    ['supplies bootstrap', '/api/supplies/bootstrap'],
    ['operational insights', '/api/intelligence'],
    ['live workforce', '/api/workforce/live'],
    ['time entries', '/api/time-entries'],
    ['field control', '/api/field-control'],
  ]
  for (const [name, path] of authenticatedReads) rows.push(await measure(name, path, authHeaders))
} else {
  console.log('Authenticated endpoint sampling skipped. Set PERFORMANCE_EMAIL and PERFORMANCE_PASSWORD to include read-only operational endpoints.')
}

console.log(`target=${origin.origin}`)
console.log(`samples_per_endpoint=${samples}`)
console.log(`concurrency=${concurrency}`)
for (const row of rows) {
  console.log([
    `endpoint=${row.name}`,
    `successes=${row.successes}`,
    `failures=${row.failures}`,
    `p50_ms=${row.p50Ms ?? 'n/a'}`,
    `p95_ms=${row.p95Ms ?? 'n/a'}`,
    `max_ms=${row.maxMs ?? 'n/a'}`,
    `payload_p50_bytes=${row.payloadP50Bytes ?? 'n/a'}`,
    `statuses=${row.statuses.join(',') || 'n/a'}`,
  ].join(' '))
}

if (rows.some((row) => row.failures > 0)) process.exitCode = 1
