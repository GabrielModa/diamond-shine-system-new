import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { root, mobileRoot, selectLanAddress, mobileEnvironment } from './mobile-environment.mjs'
const mode = process.argv[2] ?? 'all'
if (!['all', 'web', 'mobile', 'prod-api'].includes(mode)) throw new Error(`Unknown mode: ${mode}`)
const children = []
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.pid) continue
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
  }
  setTimeout(() => {
    if (process.platform !== 'win32') for (const child of children) { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
    process.exit(code)
  }, 1000)
}
function start(label, cwd, cli, args, env, input) {
  if (!existsSync(join(cwd, cli))) throw new Error(`Missing ${label} dependencies. Run npm ci and npm --prefix apps/mobile ci from the root.`)
  const child = spawn(process.execPath, [join(cwd, cli), ...args], { cwd, env, stdio: [input, 'inherit', 'inherit'], detached: process.platform !== 'win32' })
  children.push(child)
  child.on('error', error => { console.error(error.message); stop(1) })
  child.on('exit', code => { if (!stopping) { console.error(`${label} exited; stopping development.`); stop(code ?? 1) } })
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
try {
  for (const port of mode === 'all' ? [3000, 8081] : mode === 'web' ? [3000] : [8081]) {
    await new Promise((resolve, reject) => {
      const probe = createServer()
      probe.once('error', () => reject(new Error(`Port ${port} is unavailable. Stop the existing server using its terminal before restarting; no automatic port switching.`)))
      probe.listen(port, '0.0.0.0', () => probe.close(resolve))
    })
  }
  const address = mode === 'web' ? null : selectLanAddress(undefined, process.env.DIAMOND_LAN_IP)
  const env = address ? mobileEnvironment(process.env, address, mode === 'prod-api') : null
  console.log('\nDiamond Shine local development\n\nWeb on this PC: http://localhost:3000')
  if (env) console.log(`Web/API from phone: ${env.EXPO_PUBLIC_API_URL}\nAPI health: ${env.EXPO_PUBLIC_API_URL}/api/health/live\nMetro: http://${address}:8081\nMobile runtime: Development Client\n${mode === 'prod-api' ? '\n*** PRODUCTION API: actions affect real production data ***\n' : ''}\nIf your phone cannot connect:\n- confirm same Wi-Fi\n- test API /api/health/live and Metro /status\n- check Windows Firewall ports 3000 and 8081\n- use DIAMOND_LAN_IP to select another adapter\n`)
  if (mode === 'all' || mode === 'web') start('Next.js', root, 'node_modules/next/dist/bin/next', ['dev', '--hostname', '0.0.0.0', '--port', '3000'], process.env, mode === 'web' ? 'inherit' : 'ignore')
  if (env) start('Expo', mobileRoot, 'node_modules/expo/bin/cli', ['start', '--dev-client', '--lan', '--port', '8081'], env, 'inherit')
} catch (error) { console.error(error.message); stop(1) }
