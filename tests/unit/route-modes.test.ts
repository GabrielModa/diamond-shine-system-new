import { describe, expect, it } from 'vitest'
import { googleMapsTravelMode, googleTravelMode } from '../../src/lib/route-modes'

describe('route mode translation', () => {
  it.each([
    ['driving', 'DRIVE'],
    ['transit', 'TRANSIT'],
    ['cycling', 'BICYCLE'],
    ['walking', 'WALK'],
  ] as const)('maps %s to Google Routes %s', (input, expected) => {
    expect(googleTravelMode(input)).toBe(expected)
  })

  it.each([
    ['driving', 'driving'],
    ['transit', 'transit'],
    ['cycling', 'bicycling'],
    ['walking', 'walking'],
  ] as const)('maps %s to Google Maps URL mode %s', (input, expected) => {
    expect(googleMapsTravelMode(input)).toBe(expected)
  })
})
