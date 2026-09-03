import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pageMeta } from '../../src/lib/navigation'

function protectedTopLevelPages() {
  const root = path.join(process.cwd(), 'src', 'app', '(protected)')
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(root, entry.name, 'page.tsx')))
    .map((entry) => entry.name)
    .sort()
}

describe('protected navigation registry', () => {
  it('accounts for every top-level protected page so modules cannot disappear silently', () => {
    expect(Object.keys(pageMeta).sort()).toEqual(protectedTopLevelPages())
  })

  it('keeps route keys, hrefs and labels unique and coherent', () => {
    const entries = Object.entries(pageMeta)
    expect(new Set(entries.map(([, meta]) => meta.href)).size).toBe(entries.length)
    expect(new Set(entries.map(([, meta]) => meta.label)).size).toBe(entries.length)

    for (const [route, meta] of entries) {
      expect(meta.href).toBe(`/${route}`)
      expect(meta.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('hides only advanced registries from normal navigation', () => {
    const hidden = Object.entries(pageMeta)
      .filter(([, meta]) => meta.nav === false)
      .map(([route]) => route)
      .sort()

    expect(hidden).toEqual(['operations', 'work-orders'])
    expect(pageMeta.feedback).toMatchObject({ label: 'Service feedback' })
    expect(pageMeta.feedback.nav).not.toBe(false)
    expect(pageMeta.dashboard).toMatchObject({ label: 'Management dashboard' })
    expect(pageMeta.dashboard.nav).not.toBe(false)
  })

  it('has deterministic ordering inside each navigation section', () => {
    for (const section of ['control', 'analytics', 'admin', 'workspace'] as const) {
      const orders = Object.values(pageMeta)
        .filter((meta) => meta.section === section && meta.nav !== false)
        .map((meta) => meta.order)
      expect(new Set(orders).size).toBe(orders.length)
      expect(orders.every((order) => Number.isInteger(order) && order > 0)).toBe(true)
    }
  })
})
