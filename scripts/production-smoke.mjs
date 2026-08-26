const base = (process.env.NEXTAUTH_URL || process.argv[2] || '').replace(/\/$/, '')
if (!base) {
  console.error('Set NEXTAUTH_URL or pass the production origin as the first argument.')
  process.exit(1)
}

async function probe(path, expectedStatus) {
  const started = Date.now()
  const response = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' }, redirect: 'manual' })
  const body = await response.json().catch(() => null)
  if (response.status !== expectedStatus || !body?.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  console.log(`✓ ${path} ${response.status} (${Date.now() - started}ms)`)
  return body
}

try {
  await probe('/api/health/live', 200)
  const ready = await probe('/api/health', 200)
  console.log(`Release: ${ready.data?.release ?? 'unknown'} · database=${ready.data?.database ?? 'unknown'} · evidence=${ready.data?.evidenceStorage ?? 'unknown'}`)
} catch (error) {
  console.error(`Production smoke failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
