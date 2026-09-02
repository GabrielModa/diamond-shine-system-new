import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadEnvConfig } from '@next/env'
import { assertIntegrationDatabaseSafe } from '../tests/integration/database-safety'

// No reset/drop: each audit owns a new schema, never the development schema.
const allowedSpecs = ['scheduling', 'workforce', 'schedule-hardening', 'schedule-capacity-availability', 'service-continuity', 'execution']
const selectedSpecs = process.argv.slice(2)
if (selectedSpecs.some((spec) => !allowedSpecs.includes(spec))) {
  throw new Error(`Expected audit suite names: ${allowedSpecs.join(', ')}`)
}
loadEnvConfig(process.cwd())
const url = new URL(process.env.DATABASE_URL ?? '')
const schema = `integration_audit_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
const env = { ...process.env, DATABASE_URL: url.toString() }
assertIntegrationDatabaseSafe(env.DATABASE_URL)
console.log(`Isolated test schema: ${schema}. Retained after the run for diagnosis.`)

function run(script: string, args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('node_modules/prisma/build/index.js', ['db', 'push', '--skip-generate'])
for (const spec of selectedSpecs.length ? selectedSpecs : allowedSpecs) {
  run('node_modules/vitest/vitest.mjs', ['run', `tests/integration/${spec}.test.ts`, '--maxWorkers=1', '--testTimeout=30000'])
}
