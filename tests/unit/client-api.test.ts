import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientApi } from '../../src/lib/client-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('clientApi', () => {
  it('returns data from a valid API envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, data: { value: 42 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))

    await expect(clientApi<{ value: number }>('/api/test')).resolves.toEqual({ value: 42 })
  })

  it('surfaces structured API errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: false, error: 'Database unavailable' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    )))

    await expect(clientApi('/api/test')).rejects.toThrow('Database unavailable')
  })

  it('turns an empty server response into a useful HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })))

    await expect(clientApi('/api/test', undefined, 'Could not load field control'))
      .rejects.toThrow('Could not load field control (HTTP 500: empty response).')
  })

  it('turns non-JSON server output into a useful HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>gateway failure</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    })))

    await expect(clientApi('/api/test', undefined, 'Could not load field control'))
      .rejects.toThrow('Could not load field control (HTTP 502: invalid server response).')
  })
})
