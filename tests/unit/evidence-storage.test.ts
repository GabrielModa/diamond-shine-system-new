import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectEvidenceMimeType,
  ensureEvidenceStorageReady,
  evidenceStorageProvider,
  readEvidence,
  removeEvidence,
  safeDownloadName,
  storeEvidence,
} from '../../src/lib/evidence-storage'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function configureSupabaseStorage() {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('EVIDENCE_STORAGE_PROVIDER', 'supabase')
  vi.stubEnv('SUPABASE_URL', 'https://project-ref.supabase.co')
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_test-only')
  vi.stubEnv('SUPABASE_EVIDENCE_BUCKET', 'diamond-shine-evidence')
}

describe('evidence storage validation', () => {
  it('detects supported image signatures instead of trusting extensions', () => {
    expect(detectEvidenceMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg')
    expect(detectEvidenceMimeType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(detectEvidenceMimeType(new TextEncoder().encode('not-an-image'))).toBeNull()
  })

  it('sanitizes download names before writing response headers', () => {
    expect(safeDownloadName('../../proof\n\".jpg')).toBe('.._.._proof__.jpg')
  })

  it('defaults to filesystem outside production but requires an explicit provider in production', () => {
    expect(evidenceStorageProvider({ NODE_ENV: 'development' })).toBe('filesystem')
    expect(() => evidenceStorageProvider({ NODE_ENV: 'production' })).toThrow(/EVIDENCE_STORAGE_PROVIDER/)
  })

  it('checks that the configured Supabase evidence bucket exists and is private', async () => {
    configureSupabaseStorage()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'diamond-shine-evidence', public: false }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(ensureEvidenceStorageReady()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://project-ref.supabase.co/storage/v1/bucket/diamond-shine-evidence')
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get('apikey')).toBe('sb_secret_test-only')
    expect(headers.get('authorization')).toBe('Bearer sb_secret_test-only')
  })

  it('fails closed when the Supabase evidence bucket is public or its privacy cannot be verified', async () => {
    configureSupabaseStorage()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'diamond-shine-evidence', public: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(ensureEvidenceStorageReady()).rejects.toThrow(/private/)
    await expect(ensureEvidenceStorageReady()).rejects.toThrow(/private/)
  })

  it('rejects a Supabase URL that is not a clean origin', async () => {
    configureSupabaseStorage()
    vi.stubEnv('SUPABASE_URL', 'https://project-ref.supabase.co/storage')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(ensureEvidenceStorageReady()).rejects.toThrow(/valid origin/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses private Supabase Storage for upload, download and removal', async () => {
    configureSupabaseStorage()
    const uploadedBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0x00])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ Key: 'stored' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(uploadedBytes, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const stored = await storeEvidence({
      organizationId: 'org-1',
      visitId: 'visit-1',
      bytes: uploadedBytes,
      declaredMimeType: 'image/jpeg',
    })
    expect(stored.storageKey).toMatch(/^evidence\/org-1\/visit-1\/.+\.jpg$/)
    expect(Buffer.isBuffer(fetchMock.mock.calls[0][1]?.body)).toBe(true)

    const read = await readEvidence(stored.storageKey)
    expect(Array.from(read)).toEqual(Array.from(uploadedBytes))
    await expect(removeEvidence(stored.storageKey)).resolves.toBeUndefined()

    const uploadUrl = String(fetchMock.mock.calls[0][0])
    const readUrl = String(fetchMock.mock.calls[1][0])
    const removeUrl = String(fetchMock.mock.calls[2][0])
    expect(uploadUrl).toContain('/storage/v1/object/diamond-shine-evidence/evidence/org-1/visit-1/')
    expect(readUrl).toContain('/storage/v1/object/authenticated/diamond-shine-evidence/evidence/org-1/visit-1/')
    expect(removeUrl).toBe('https://project-ref.supabase.co/storage/v1/object/diamond-shine-evidence')
    expect(fetchMock.mock.calls[2][1]?.method).toBe('DELETE')
  })
})
