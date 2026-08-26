import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
let failures = 0
function read(rel) {
  const file = path.join(root, rel)
  if (!fs.existsSync(file)) {
    console.error(`FAIL missing ${rel}`)
    failures += 1
    return ''
  }
  return fs.readFileSync(file, 'utf8')
}
function expect(rel, marker, description = marker) {
  const source = read(rel)
  if (!source.includes(marker)) {
    console.error(`FAIL ${rel}: ${description}`)
    failures += 1
  } else console.log(`PASS ${rel}: ${description}`)
}
function reject(rel, marker, description = marker) {
  const source = read(rel)
  if (source.includes(marker)) {
    console.error(`FAIL ${rel}: forbidden ${description}`)
    failures += 1
  } else console.log(`PASS ${rel}: no ${description}`)
}

reject('apps/mobile/lib/push.ts', "import * as Notifications from 'expo-notifications'", 'static expo-notifications import')
reject('apps/mobile/app/_layout.tsx', "import * as Notifications from 'expo-notifications'", 'static expo-notifications import')
expect('apps/mobile/lib/push.ts', "await import('expo-notifications')", 'runtime notification import')
expect('apps/mobile/app/_layout.tsx', 'getLastNotificationResponseAsync', 'cold-start notification response')
expect('apps/mobile/app/_layout.tsx', 'SafeAreaProvider', 'safe-area provider')
expect('apps/mobile/components/ui.tsx', 'react-native-safe-area-context', 'safe-area screen primitive')
expect('apps/mobile/app/camera/[visitId].tsx', 'permission.canAskAgain', 'permanent camera-denial recovery')
expect('apps/mobile/lib/api.ts', 'response.status === 207', 'partial sync response support')
expect('apps/mobile/lib/offline.ts', 'OfflineWorkspaceBusyError', 'cross-account offline protection')
expect('apps/mobile/lib/offline.ts', 'persistEvidenceFile', 'durable offline evidence')
expect('apps/mobile/lib/offline.ts', "operation.type !== 'visit.complete'", 'completion-last queue ordering')
expect('apps/mobile/lib/offline.ts', 'syncInFlight', 'single-flight sync')
expect('apps/mobile/lib/offline.ts', 'getAnyLocalTimer', 'single local timer guard')
expect('apps/mobile/app/visit/[id].tsx', 'versionTaskId: task.versionTask.id', 'offline task identity')
expect('apps/mobile/app/visit/[id].tsx', "session?.membershipRole === 'employee'", 'field-role execution boundary')
expect('apps/mobile/app/(tabs)/index.tsx', 'operationalGreeting', 'operational timezone home')
expect('apps/mobile/app/(tabs)/schedule.tsx', 'formatOperationalTime', 'operational timezone schedule')
expect('src/app/api/auth/login/route.ts', 'membershipRole: membership.role', 'mobile membership role bootstrap')
expect('src/app/api/auth/login/route.ts', 'timezone: membership.organization.timezone', 'mobile organization timezone bootstrap')
expect('src/app/api/sync/route.ts', 'include: { evidence: true, versionTask: true }', 'sync task-result metadata')
expect('src/app/api/visits/[id]/evidence-upload/route.ts', "form?.get('versionTaskId')", 'binary evidence version-task resolution')
expect('docs/PRODUCT_BEHAVIOR_REGISTRY.md', '## Post-RC Mobile Pilot Hardening — Android / iOS', 'registry checkpoint')

reject('apps/mobile/lib/evidence-storage.ts', "import { Directory, File, Paths } from 'expo-file-system'", 'eager native filesystem import')
expect('apps/mobile/lib/evidence-storage.ts', "if (Platform.OS === 'web') return null", 'web-safe native filesystem boundary')
expect('apps/mobile/lib/offline.ts', 'await persistEvidenceFile(input.uri, input.id, mimeType)', 'async durable evidence copy')
expect('apps/mobile/lib/offline.ts', 'await removeEvidenceFile(row.uri)', 'async evidence cleanup')
expect('vitest.mobile-hardening.config.ts', "include: ['tests/integration/mobile-pilot-hardening.test.ts']", 'single-suite integration isolation')

const mobilePackage = JSON.parse(read('apps/mobile/package.json') || '{}')
if (mobilePackage.dependencies?.['expo-file-system'] !== '~19.0.24') { console.error('FAIL apps/mobile/package.json: expo-file-system SDK 54 pin'); failures += 1 } else console.log('PASS apps/mobile/package.json: expo-file-system SDK 54 pin')
if (mobilePackage.dependencies?.['expo-dev-client'] !== '~6.0.21') { console.error('FAIL apps/mobile/package.json: expo-dev-client SDK 54 pin'); failures += 1 } else console.log('PASS apps/mobile/package.json: expo-dev-client SDK 54 pin')
const appConfig = JSON.parse(read('apps/mobile/app.json') || '{}')
const plugins = appConfig.expo?.plugins ?? []
const devClient = plugins.some((plugin) => plugin === 'expo-dev-client' || (Array.isArray(plugin) && plugin[0] === 'expo-dev-client'))
if (!devClient) { console.error('FAIL apps/mobile/app.json: expo-dev-client plugin'); failures += 1 } else console.log('PASS apps/mobile/app.json: expo-dev-client plugin')

if (failures) {
  console.error(`\nMobile pilot source check failed: ${failures} issue${failures === 1 ? '' : 's'}.`)
  process.exit(1)
}
console.log('\nMobile pilot source check passed.')
