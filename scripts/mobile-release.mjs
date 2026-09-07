import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { mobileRoot, productionApi } from './mobile-environment.mjs'
import { qualityPassed, versionMatches, compatibleBuild } from './release-policy.mjs'

const sha = process.env.RELEASE_SHA
const repository = process.env.GITHUB_REPOSITORY
if (!/^[a-f0-9]{40}$/.test(sha ?? '') || !repository || !process.env.GITHUB_TOKEN) throw new Error('Release requires an exact SHA, repository and GITHUB_TOKEN.')
const github = async path => {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${path}`)
  return response.json()
}
async function gates() {
  if ((await github('git/ref/heads/main')).object.sha !== sha) throw new Error('Release superseded: SHA is no longer main HEAD. Retry the latest commit.')
  const runs = await github(`actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`)
  if (!qualityPassed(runs.workflow_runs, sha)) return false
  // Reading the production alias proves this exact Vercel deployment is promoted
  // and serving; a successful preview/check status alone is insufficient.
  try {
    const response = await fetch(`${productionApi}/api/health/version`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    if (!response.ok || !versionMatches(await response.json(), sha)) return false
    const health = await fetch(`${productionApi}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
    return health.ok
  } catch { return false }
}
const deadline = Date.now() + 35 * 60_000
while (!await gates()) {
  if (Date.now() > deadline) throw new Error('Timed out waiting for Quality Gate and healthy production backend at the exact SHA. No OTA published.')
  console.log('Waiting for Quality Gate and exact-SHA production health...')
  await delay(20000)
}
if (!process.env.EXPO_TOKEN) throw new Error('Create GitHub Actions secret EXPO_TOKEN; see the release runbook.')
function eas(args) {
  return execFileSync(process.execPath, [join(mobileRoot, 'node_modules/eas-cli/bin/run'), ...args], { cwd: mobileRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, EXPO_NO_DOTENV: '1' }, stdio: ['ignore', 'pipe', 'inherit'] })
}
const publicApi = eas(['env:get', 'production', '--variable-name', 'EXPO_PUBLIC_API_URL', '--format', 'short', '--non-interactive']).replace(/\u001b\[[0-9;]*m/g, '')
if (!publicApi.split(/\r?\n/).some(line => line.trim() === `EXPO_PUBLIC_API_URL=${productionApi}`)) throw new Error('Set the production EAS EXPO_PUBLIC_API_URL plaintext variable to the production API. No OTA published.')
const fingerprint = JSON.parse(eas(['fingerprint:generate', '--platform', 'android', '--environment', 'production', '--json', '--non-interactive']))
if (!fingerprint.hash) throw new Error('EAS returned no fingerprint; refusing OTA.')
const builds = JSON.parse(eas(['build:list', '--platform', 'android', '--channel', 'production', '--status', 'finished', '--runtime-version', fingerprint.hash, '--limit', '50', '--json', '--non-interactive']))
if (!compatibleBuild(builds, fingerprint.hash)) throw new Error(`Native build required for runtime ${fingerprint.hash}. Run npm run mobile:build:production, install/distribute it, then retry. No OTA published.`)
if (!await gates()) throw new Error('Release gates changed before publication. Retry latest main.')
console.log(eas(['update', '--platform', 'android', '--channel', 'production', '--environment', 'production', '--message', `main ${sha}`, '--non-interactive']))
