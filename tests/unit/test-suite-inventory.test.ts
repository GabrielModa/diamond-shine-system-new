import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type PackageJson = { scripts?: Record<string, string> }

const root = process.cwd()

function filesIn(directory: string, suffix: string) {
  const absolute = path.join(root, directory)
  return readdirSync(absolute)
    .filter((name) => name.endsWith(suffix))
    .sort()
}

function allTestFiles() {
  return [
    ...filesIn('tests/unit', '.test.ts').map((name) => path.join('tests/unit', name)),
    ...filesIn('tests/integration', '.test.ts').map((name) => path.join('tests/integration', name)),
    ...filesIn('tests/e2e', '.spec.ts').map((name) => path.join('tests/e2e', name)),
  ]
}

describe('test suite inventory', () => {
  it('runs every integration test from the main integration gate', () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as PackageJson
    const scripts = packageJson.scripts ?? {}
    const mainGate = scripts['test:integration'] ?? ''
    const referencedScripts = Object.entries(scripts)
      .filter(([name]) => name.startsWith('test:integration:'))
      .filter(([name]) => mainGate.includes(`npm run ${name}`) || name === 'test:integration:schedule-hardening' || name === 'test:integration:schedule-capacity')
      .map(([, command]) => command)
      .join('\n')
    const mobileConfigPath = path.join(root, 'vitest.mobile-hardening.config.ts')
    const mobileConfig = existsSync(mobileConfigPath) ? readFileSync(mobileConfigPath, 'utf8') : ''
    const executionSurface = `${mainGate}\n${referencedScripts}\n${mobileConfig}`

    const orphaned = filesIn('tests/integration', '.test.ts')
      .filter((name) => !executionSurface.includes(name))

    expect(orphaned, `Integration tests missing from npm run test:integration: ${orphaned.join(', ')}`).toEqual([])
  })

  it('keeps unit and e2e discovery broad instead of enumerating a fragile subset', () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as PackageJson
    expect(packageJson.scripts?.['test:unit']).toContain('tests/unit')
    expect(packageJson.scripts?.['test:e2e']).toBe('playwright test')
  })

  it('does not commit focused or unconditionally skipped suites', () => {
    const offenders: string[] = []
    for (const relative of allTestFiles()) {
      const source = readFileSync(path.join(root, relative), 'utf8')
      if (/\b(?:describe|it|test)\.only\s*\(/.test(source)) offenders.push(`${relative}: .only`)
      if (/\b(?:describe|it)\.skip\s*\(/.test(source)) offenders.push(`${relative}: unconditional .skip`)
    }
    expect(offenders).toEqual([])
  })
})
