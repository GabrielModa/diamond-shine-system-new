import { spawn, spawnSync } from 'node:child_process'

let stopping = false

function spawnNpm(args, stdio) {
  const options = {
    stdio,
    env: process.env,
    windowsHide: false,
  }

  if (process.platform === 'win32') {
    const command = process.env.ComSpec || 'cmd.exe'
    return spawn(command, ['/d', '/s', '/c', 'npm', ...args], options)
  }

  return spawn('npm', args, options)
}

function start(label, args, stdin) {
  console.log(`[dev:all] starting ${label}...`)
  const child = spawnNpm(args, [stdin, 'inherit', 'inherit'])

  child.on('error', (error) => {
    console.error(`[dev:all] ${label} failed to start: ${error.message}`)
    stopAll(1)
  })

  child.on('exit', (code, signal) => {
    if (stopping) return
    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`
    console.log(`[dev:all] ${label} exited (${reason}); stopping the other process.`)
    stopAll(code ?? 0)
  })

  return child
}

const web = start('WEB', ['run', 'dev'], 'ignore')
const mobile = start('MOBILE', ['run', 'mobile:start'], 'inherit')

function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    return
  }

  try {
    child.kill('SIGTERM')
  } catch {}
}

function stopAll(code = 0) {
  if (stopping) return
  stopping = true
  killTree(web)
  killTree(mobile)
  setTimeout(() => process.exit(code), 100)
}

process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))

console.log('[dev:all] WEB + MOBILE are running. Expo owns keyboard input. Ctrl+C stops both.')
