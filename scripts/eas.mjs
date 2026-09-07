import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { mobileRoot } from './mobile-environment.mjs'
const child = spawn(process.execPath, [join(mobileRoot, 'node_modules/eas-cli/bin/run'), ...process.argv.slice(2)], { cwd: mobileRoot, env: process.env, stdio: 'inherit' })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
