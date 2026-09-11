import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

try {
  const entries = await readdir(resolve('prisma/migrations'), { withFileTypes: true })
  const expected = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  const rows = await prisma.$queryRawUnsafe(
    'SELECT "migration_name" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL',
  )
  const applied = new Set(rows.map((row) => String(row.migration_name)))
  const missing = expected.filter((name) => !applied.has(name))

  if (missing.length) {
    console.error('Production database is behind the application release.')
    console.error(`Missing Prisma migrations: ${missing.join(', ')}`)
    console.error('Apply migrations through the release/database administration path before deploying this commit.')
    process.exitCode = 1
  } else {
    console.log(`Database migration guard passed: ${expected.length} migrations applied.`)
  }
} catch (error) {
  console.error('Could not verify database migration state before build.')
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
