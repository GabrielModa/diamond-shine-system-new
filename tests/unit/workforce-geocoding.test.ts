import { afterEach, describe, expect, it } from 'vitest'
import { AddressValidationError, geocodeAddress } from '../../src/lib/geocoding'

afterEach(() => {
  delete process.env.GEOCODING_TEST_MODE
})

describe('workforce address validation', () => {
  it('returns deterministic mapped coordinates in integration test mode', async () => {
    process.env.GEOCODING_TEST_MODE = '1'
    const result = await geocodeAddress('10 Test Street, Dublin 2')
    expect(result.formattedAddress).toBe('10 Test Street, Dublin 2')
    expect(result.latitude).toBeTypeOf('number')
    expect(result.longitude).toBeTypeOf('number')
  })

  it('rejects an address explicitly treated as invalid in test mode', async () => {
    process.env.GEOCODING_TEST_MODE = '1'
    await expect(geocodeAddress('definitely invalid address')).rejects.toBeInstanceOf(AddressValidationError)
  })
})
