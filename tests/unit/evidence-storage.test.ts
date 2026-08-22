import { describe, expect, it } from 'vitest'
import { detectEvidenceMimeType, safeDownloadName } from '../../src/lib/evidence-storage'

describe('evidence storage validation', () => {
  it('detects supported image signatures instead of trusting extensions', () => {
    expect(detectEvidenceMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg')
    expect(detectEvidenceMimeType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(detectEvidenceMimeType(new TextEncoder().encode('not-an-image'))).toBeNull()
  })

  it('sanitizes download names before writing response headers', () => {
    expect(safeDownloadName('../../proof\n\".jpg')).toBe('.._.._proof__.jpg')
  })
})
