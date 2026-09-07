import { assertDestructiveDatabaseSafe } from '../src/lib/destructive-db-guard'

const result = assertDestructiveDatabaseSafe()
console.log(`[DB SAFETY] ${result.reason}`)
