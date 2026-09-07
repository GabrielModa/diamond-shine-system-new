import test from 'node:test'
import assert from 'node:assert/strict'
import { selectLanAddress, mobileEnvironment, productionApi } from '../../scripts/mobile-environment.mjs'
import { qualityPassed, versionMatches, compatibleBuild } from '../../scripts/release-policy.mjs'
const adapter = address => [{ family: 'IPv4', internal: false, address }]
test('LAN prefers Wi-Fi and ignores virtual, internal and link-local interfaces', () => {
  assert.equal(selectLanAddress({ Ethernet: adapter('10.0.0.8'), 'Wi-Fi': adapter('192.168.0.5'), vEthernet: adapter('172.20.0.1') }), '192.168.0.5')
  assert.throws(() => selectLanAddress({ loop: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }], Ethernet: adapter('169.254.1.1') }))
})
test('adapter override must belong to this PC', () => {
  assert.equal(selectLanAddress({ VPN: adapter('10.1.1.1') }, '10.1.1.1'), '10.1.1.1')
  assert.throws(() => selectLanAddress({ Ethernet: adapter('10.0.0.2') }, '127.0.0.1'))
})
test('launcher overrides stale public URL and excludes server credentials', () => {
  const env = mobileEnvironment({ EXPO_PUBLIC_API_URL: 'http://localhost:3000', DATABASE_URL: 'private', SESSION_SECRET: 'private', Path: 'node' }, '192.168.1.3')
  assert.equal(env.EXPO_PUBLIC_API_URL, 'http://192.168.1.3:3000')
  assert.equal(env.DATABASE_URL, undefined)
  assert.equal(env.SESSION_SECRET, undefined)
  assert.equal(env.EXPO_NO_DOTENV, '1')
  assert.equal(env.Path, 'node')
  assert.equal(mobileEnvironment({}, '192.168.1.3', true).EXPO_PUBLIC_API_URL, productionApi)
})
test('quality requires latest exact-SHA push on main', () => {
  const good = { head_sha: 'abc', head_branch: 'main', event: 'push', conclusion: 'success', run_number: 1, run_attempt: 1 }
  assert.ok(qualityPassed([good], 'abc'))
  assert.equal(qualityPassed([good], 'other'), false)
  assert.equal(qualityPassed([good, { ...good, run_attempt: 2, conclusion: 'failure' }], 'abc'), false)
  assert.equal(qualityPassed([{ ...good, event: 'pull_request' }], 'abc'), false)
})
test('production must serve the exact release SHA', () => {
  assert.ok(versionMatches({ gitSha: 'abc', environment: 'production' }, 'abc'))
  assert.equal(versionMatches({ gitSha: 'abc', environment: 'preview' }, 'abc'), false)
  assert.equal(versionMatches({ gitSha: 'old', environment: 'production' }, 'abc'), false)
})
test('runtime must match a completed Android production binary', () => {
  const hash = 'a'.repeat(40)
  const good = { status: 'FINISHED', platform: 'ANDROID', channel: 'production', runtimeVersion: hash }
  assert.ok(compatibleBuild([good], hash))
  for (const change of [{ status: 'ERRORED' }, { platform: 'IOS' }, { channel: 'preview' }, { runtimeVersion: 'b'.repeat(40) }]) assert.equal(compatibleBuild([{ ...good, ...change }], hash), false)
  assert.equal(compatibleBuild([], hash), false)
})
