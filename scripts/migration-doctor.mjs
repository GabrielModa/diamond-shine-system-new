import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const inherited = new Set(Object.entries(process.env).filter(([, value]) => Boolean(value)).map(([key]) => key))

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match || inherited.has(match[1])) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

loadEnvFile(path.resolve('.env'))
loadEnvFile(path.resolve('.env.local'))

const raw = process.env.DATABASE_URL?.trim()
if (!raw) {
  console.error('DATABASE_URL is not configured. No database changes were made.')
  process.exit(1)
}

let url
try {
  url = new URL(raw)
} catch {
  console.error('DATABASE_URL is invalid. No database changes were made.')
  process.exit(1)
}

if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
  console.error('DATABASE_URL must use PostgreSQL. No database changes were made.')
  process.exit(1)
}

const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
const schema = url.searchParams.get('schema') || 'public'
const migrationsPath = path.resolve('prisma', 'migrations')
const repositoryMigrations = existsSync(migrationsPath)
  ? readdirSync(migrationsPath, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
  : 0

console.log(`host=${url.hostname}`)
console.log(`database=${database}`)
console.log(`schema=${schema}`)
console.log(`repositoryMigrations=${repositoryMigrations}`)
console.log('mode=read-only migration history check')

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const result = spawnSync(command, ['prisma', 'migrate', 'status', '--schema', 'prisma/schema.prisma'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) {
  console.error(`Could not run Prisma migration status: ${result.error.message}`)
  process.exit(1)
}

if ((result.status ?? 1) !== 0) {
  console.error('Migration history is not clean. Do not reset this database. Preserve it as legacy and use a clean dedicated development database/schema for future migrate dev work.')
  process.exit(result.status ?? 1)
}

console.log('Migration history is clean. No database changes were made.')
