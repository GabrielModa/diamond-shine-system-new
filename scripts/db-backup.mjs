import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const raw = process.env.DATABASE_URL
if (!raw) {
  console.error('DATABASE_URL is required. Run this command in the production environment or export the variable first.')
  process.exit(1)
}

let database
try { database = new URL(raw) } catch {
  console.error('DATABASE_URL is not a valid URL.')
  process.exit(1)
}
if (!['postgres:', 'postgresql:'].includes(database.protocol)) {
  console.error('db:backup supports PostgreSQL DATABASE_URL values only.')
  process.exit(1)
}

const outputDir = path.resolve(process.env.BACKUP_DIR || 'backups')
await fs.mkdir(outputDir, { recursive: true })
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const output = path.join(outputDir, `diamond-shine_${timestamp}.dump`)
const childEnv = {
  ...process.env,
  PGHOST: database.hostname,
  PGPORT: database.port || '5432',
  PGUSER: decodeURIComponent(database.username),
  PGPASSWORD: decodeURIComponent(database.password),
  PGDATABASE: database.pathname.replace(/^\//, ''),
  ...(database.searchParams.get('sslmode') ? { PGSSLMODE: database.searchParams.get('sslmode') } : {}),
}

const args = ['--format=custom', '--no-owner', '--no-acl', '--file', output]
const child = spawn('pg_dump', args, { stdio: 'inherit', env: childEnv, shell: false })
child.on('error', (error) => {
  console.error(`Could not start pg_dump: ${error.message}`)
  process.exit(1)
})
child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`pg_dump failed with exit code ${code}`)
    process.exit(code ?? 1)
  }
  console.log(`Backup created: ${output}`)
  console.log('Copy this dump to encrypted off-site storage; a local file alone is not a production backup.')
})
