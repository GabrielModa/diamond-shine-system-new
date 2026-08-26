import fs from 'node:fs'
import path from 'node:path'
import { assessProductionReadiness } from '../src/lib/production-readiness'

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    if (process.env[key] !== undefined) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    process.env[key] = value
  }
}

for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) loadEnvFile(path.resolve(process.cwd(), name))
process.env.PRODUCTION_READINESS_STRICT = 'true'

const result = assessProductionReadiness(process.env)
console.log('\nDiamond Shine production configuration')
for (const check of result.checks) console.log(`${check.ok ? '✓' : '✗'} ${check.key}: ${check.message}`)
if (!result.ready) {
  console.error('\nProduction configuration is NOT ready. No secret values were printed.')
  process.exit(1)
}
console.log('\nProduction configuration is ready. Secret values were not printed.')
