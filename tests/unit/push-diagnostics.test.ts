import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findTokens: vi.fn(),
  updateTokens: vi.fn(),
  membership: vi.fn(),
  audit: vi.fn(),
}))

vi.mock('../../src/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('../../src/lib/audit', () => ({ logAudit: mocks.audit }))
vi.mock('../../src/lib/prisma', () => ({
  prisma: {
    devicePushToken: { findMany: mocks.findTokens, updateMany: mocks.updateTokens },
    membership: { findFirst: mocks.membership },
  },
}))

import { sendPushDiagnostic } from '../../src/lib/push-notifications'
import { GET, POST } from '../../src/app/api/notifications/test-push/route'

const request = (path: string, init?: RequestInit) => new NextRequest(`http://localhost${path}`, init)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: 'admin', email: 'admin@ds.ie', organizationId: 'org' } })
  mocks.membership.mockResolvedValue({ user: { id: 'employee', name: 'Employee', email: 'employee@ds.ie' } })
  mocks.findTokens.mockResolvedValue([{
    id: 'token-id',
    token: 'ExponentPushToken[integration-device-token]',
    platform: 'android',
    lastRegisteredAt: new Date('2026-09-15T15:00:00.000Z'),
  }])
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ data: [{ status: 'ok', id: 'expo-ticket-1' }] }),
  }))
})

describe('mobile push diagnostic', () => {
  it('reports Expo acceptance without claiming phone display', async () => {
    const result = await sendPushDiagnostic('employee', 'org')
    expect(result).toEqual(expect.objectContaining({
      ok: true,
      registered: 1,
      accepted: 1,
      failed: 0,
      ticketIds: ['expo-ticket-1'],
      platforms: ['android'],
    }))
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/push/send'), expect.objectContaining({ method: 'POST' }))
  })

  it('returns a clear no-device result without calling Expo', async () => {
    mocks.findTokens.mockResolvedValue([])
    const result = await sendPushDiagnostic('employee', 'org')
    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'no_devices', registered: 0 }))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lists only safe registered-device metadata for admins', async () => {
    mocks.findTokens.mockResolvedValue([{
      userId: 'employee',
      platform: 'android',
      lastRegisteredAt: new Date('2026-09-15T15:00:00.000Z'),
      user: { id: 'employee', name: 'Employee', email: 'employee@ds.ie' },
    }])
    const response = await GET(request('/api/notifications/test-push'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.targets[0]).toEqual(expect.objectContaining({
      id: 'employee',
      email: 'employee@ds.ie',
      deviceCount: 1,
      platforms: ['android'],
    }))
    expect(JSON.stringify(body)).not.toContain('ExponentPushToken')
  })

  it('sends a controlled push only to an active organization member', async () => {
    const response = await POST(request('/api/notifications/test-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'employee' }),
    }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toEqual(expect.objectContaining({
      registered: 1,
      accepted: 1,
      target: { id: 'employee', name: 'Employee', email: 'employee@ds.ie' },
    }))
    expect(mocks.audit).toHaveBeenCalledWith('admin@ds.ie', 'test_mobile_push', 'user', 'employee', expect.any(Object), 'org')
  })

  it('rejects unauthorized access before exposing registered devices', async () => {
    mocks.auth.mockResolvedValue({ response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })
    expect((await GET(request('/api/notifications/test-push'))).status).toBe(403)
    expect(mocks.findTokens).not.toHaveBeenCalled()
  })
})
