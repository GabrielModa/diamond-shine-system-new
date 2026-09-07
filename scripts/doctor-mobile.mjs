import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { mobileRoot, root, selectLanAddress, productionApi } from './mobile-environment.mjs'
console.log(`Node ${process.version} (use Node 22 LTS); npm ${process.env.npm_config_user_agent ?? 'run via npm run doctor:mobile'}`)
for (const directory of [root, mobileRoot]) console.log(`${directory}: dependencies ${existsSync(join(directory, 'node_modules')) ? 'installed' : 'MISSING: run npm ci here'}`)
const config = JSON.parse(readFileSync(join(mobileRoot, 'app.json'))).expo
console.log(`EAS: ${config.owner}/${config.slug}; projectId=${config.extra?.eas?.projectId}`)
if (config.extra?.eas?.projectId !== '8aa9ac64-8d87-4aea-b2f8-79258d269e29') process.exitCode = 1
for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
  const file = join(mobileRoot, name)
  if (!existsSync(file)) continue
  const source = readFileSync(file, 'utf8')
  console.log(`${name}: present (ignored by standard launchers)`)
  if (/EXPO_PUBLIC_API_URL\s*=.*(?:localhost|127\.0\.0\.1|\[::1\])/i.test(source)) console.warn('WARNING: localhost API cannot reach this PC from a physical phone.')
  if (/^\s*(?:DATABASE_URL|SESSION_SECRET|SMTP_\w+|\w*SERVICE_ROLE\w*)\s*=/m.test(source)) console.warn('WARNING: server variable found in mobile env. Remove it; never copy root .env.')
}
if (/localhost|127\.0\.0\.1/.test(process.env.EXPO_PUBLIC_API_URL ?? '')) console.warn('WARNING: inherited API URL uses localhost; standard launchers override it.')
let address
try { address = selectLanAddress(undefined, process.env.DIAMOND_LAN_IP); console.log(`LAN IPv4: ${address}`) } catch (error) { console.warn(error.message) }
await Promise.all([...(address ? [`http://${address}:3000/api/health/live`, `http://${address}:8081/status`] : []), `${productionApi}/api/health/live`].map(async url => {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(5000) }); console.log(`${url}: HTTP ${response.status}`) } catch { console.warn(`${url}: unreachable; start the server or check network access`) }
}))
const adb = spawnSync('adb', ['version'], { encoding: 'utf8', windowsHide: true })
console.log(`adb: ${adb.status === 0 ? 'available' : 'not found; install Android platform-tools for USB troubleshooting'}`)
console.log('Windows: allow Node.js on Private networks; inspect inbound TCP 3000 and 8081. No firewall settings were changed. Phone and PC must share Wi-Fi; guest/AP isolation and VPN can block access.')
const expo = join(mobileRoot, 'node_modules/expo/bin/cli')
if (existsSync(expo)) {
  const check = spawnSync(process.execPath, [expo, 'install', '--check'], { cwd: mobileRoot, stdio: 'inherit', env: { ...process.env, CI: '1', EXPO_NO_DOTENV: '1' } })
  if (check.status !== 0) { console.warn('Expo compatibility check failed. Review output and run Expo doctor after fixing dependencies/network.'); process.exitCode = 1 }
}
