const configuredUrl = process.env.HEALTH_CHECK_URL?.trim()
const applicationUrl = process.env.NEXTAUTH_URL?.trim()
const target = configuredUrl || (applicationUrl ? new URL('/api/health', applicationUrl).toString() : '')

if (!target) {
  console.error('Set HEALTH_CHECK_URL or NEXTAUTH_URL before running the health latency report.')
  process.exit(1)
}

let healthUrl
try {
  healthUrl = new URL(target)
} catch {
  console.error('Health check URL is invalid.')
  process.exit(1)
}

if (!['http:', 'https:'].includes(healthUrl.protocol)) {
  console.error('Health check URL must use HTTP or HTTPS.')
  process.exit(1)
}

const requestedSamples = Number(process.env.HEALTH_LATENCY_SAMPLES ?? '20')
const sampleCount = Number.isInteger(requestedSamples) ? Math.min(200, Math.max(1, requestedSamples)) : 20
const httpDurations = []
const databaseDurations = []
let failures = 0

function percentile(values, percentileValue) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
  return Math.round(sorted[index] * 10) / 10
}

for (let index = 0; index < sampleCount; index += 1) {
  const startedAt = performance.now()
  try {
    const response = await fetch(healthUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    const durationMs = performance.now() - startedAt
    if (!response.ok) {
      failures += 1
      continue
    }
    httpDurations.push(durationMs)
    const payload = await response.json().catch(() => null)
    const databaseMs = payload?.data?.latencyMs?.database
    if (typeof databaseMs === 'number' && Number.isFinite(databaseMs)) databaseDurations.push(databaseMs)
  } catch {
    failures += 1
  }
}

console.log(`samples=${sampleCount}`)
console.log(`successes=${httpDurations.length}`)
console.log(`failures=${failures}`)
console.log(`http_p50_ms=${percentile(httpDurations, 50) ?? 'n/a'}`)
console.log(`http_p95_ms=${percentile(httpDurations, 95) ?? 'n/a'}`)
console.log(`db_p50_ms=${percentile(databaseDurations, 50) ?? 'n/a'}`)
console.log(`db_p95_ms=${percentile(databaseDurations, 95) ?? 'n/a'}`)

if (failures > 0 || httpDurations.length === 0) process.exit(1)
