const base = (process.env.NEXTAUTH_URL || process.argv[2] || '').replace(/\/$/, '')
if (!base) {
  console.error('Set NEXTAUTH_URL or pass the production origin as the first argument.')
  process.exit(1)
}

let parsed
try { parsed = new URL(base) } catch {
  console.error('Production origin is not a valid URL.')
  process.exit(1)
}
if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
  console.error('Production smoke refuses a non-HTTPS remote origin.')
  process.exit(1)
}

function assertHeader(response, key, expected) {
  const value = response.headers.get(key) || ''
  if (expected instanceof RegExp ? !expected.test(value) : !value.toLowerCase().includes(String(expected).toLowerCase())) {
    throw new Error(`${key} header is missing or invalid.`)
  }
}

async function probeJson(path, expectedStatus) {
  const started = Date.now()
  const response = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' }, redirect: 'manual' })
  const body = await response.json().catch(() => null)
  if (response.status !== expectedStatus || !body?.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  assertHeader(response, 'cache-control', /no-store/i)
  console.log(`✓ ${path} ${response.status} (${Date.now() - started}ms)`)
  return body
}

async function probeSecurityHeaders() {
  const response = await fetch(`${base}/login`, { redirect: 'manual' })
  if (response.status !== 200) throw new Error(`/login returned HTTP ${response.status}`)
  assertHeader(response, 'content-security-policy', "default-src 'self'")
  assertHeader(response, 'x-content-type-options', 'nosniff')
  assertHeader(response, 'x-frame-options', 'DENY')
  assertHeader(response, 'referrer-policy', 'strict-origin-when-cross-origin')
  if (parsed.protocol === 'https:') assertHeader(response, 'strict-transport-security', /max-age=/i)
  console.log('✓ browser security headers')
}

try {
  await probeJson('/api/health/live', 200)
  const ready = await probeJson('/api/health', 200)
  await probeSecurityHeaders()
  console.log(`Release: ${ready.data?.release ?? 'unknown'} · database=${ready.data?.database ?? 'unknown'} · evidence=${ready.data?.evidenceStorage ?? 'unknown'}`)
} catch (error) {
  console.error(`Production smoke failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
