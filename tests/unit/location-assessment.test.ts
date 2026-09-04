import { describe, expect, it } from 'vitest'
import { assessLocation } from '../../src/modules/execution/location'
import { startVisitSchema } from '../../src/modules/execution/schemas'

const site = {
  latitude: 53.3498,
  longitude: -6.2603,
  geofenceVerifiedM: 150,
  geofenceNearM: 250,
  geofenceSuspiciousM: 700,
} as const

function pointNorth(meters: number, accuracyM: number) {
  return {
    latitude: site.latitude + meters / 111_111,
    longitude: site.longitude,
    accuracyM,
  }
}

describe('field location assessment', () => {
  it('auto-verifies a precise point whose accuracy circle is fully inside the site radius', () => {
    const result = assessLocation(site as never, pointNorth(70, 12))
    expect(result.risk).toBe('verified')
    expect(result.classification).toBe('verified')
    expect(result.reviewRequired).toBe(false)
    expect(result.confidence).toBe('high')
  })

  it('keeps an uncertain near-site point as watch instead of accusing the worker', () => {
    const result = assessLocation(site as never, pointNorth(280, 100))
    expect(result.risk).toBe('watch')
    expect(result.classification).toBe('near')
    expect(result.reviewRequired).toBe(false)
  })

  it('reviews a confidently outside point', () => {
    const result = assessLocation(site as never, pointNorth(360, 15))
    expect(result.risk).toBe('review')
    expect(result.classification).toBe('suspicious')
    expect(result.reviewRequired).toBe(true)
    expect(result.reason).toBe('LOCATION_OUTSIDE_GEOFENCE')
  })

  it('requires review when GPS is unavailable', () => {
    const result = assessLocation(site as never, {})
    expect(result.risk).toBe('review')
    expect(result.classification).toBe('unavailable')
    expect(result.reason).toBe('GPS_UNAVAILABLE')
  })

  it('accepts and normalizes decimal accuracy values reported by real devices', () => {
    const parsed = startVisitSchema.safeParse({ latitude: 53.35, longitude: -6.26, accuracyM: 12.7 })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.accuracyM).toBe(13)
  })
})
