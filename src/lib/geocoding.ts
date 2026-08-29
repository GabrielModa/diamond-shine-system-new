type GoogleGeocodeResult = {
  formatted_address?: string
  place_id?: string
  partial_match?: boolean
  types?: string[]
  geometry?: { location?: { lat?: number; lng?: number } }
}

type GoogleGeocodeResponse = {
  status?: string
  error_message?: string
  results?: GoogleGeocodeResult[]
}

export class AddressValidationError extends Error {
  constructor(message: string, public readonly status = 422) {
    super(message)
    this.name = 'AddressValidationError'
  }
}

function deterministicCoordinate(input: string) {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0
  const offset = Math.abs(hash % 8000) / 100000
  return { latitude: 53.30 + offset, longitude: -6.35 + offset / 2 }
}

export async function geocodeAddress(input: string) {
  const address = input.trim()
  if (address.length < 3) throw new AddressValidationError('Enter a complete address.')

  if (process.env.GEOCODING_TEST_MODE === '1') {
    if (/definitely invalid|not a real address/i.test(address)) {
      throw new AddressValidationError('We could not find that address on Google Maps.')
    }
    const coordinates = deterministicCoordinate(address)
    return {
      formattedAddress: address,
      ...coordinates,
      placeId: `test-${Math.abs(address.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0))}`,
    }
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    throw new AddressValidationError('Address validation is not configured. Add GOOGLE_MAPS_API_KEY before saving mapped addresses.', 503)
  }

  const params = new URLSearchParams({
    address,
    key: apiKey,
    language: 'en',
    region: 'ie',
  })

  let response: Response
  try {
    response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`, {
      cache: 'no-store',
    })
  } catch {
    throw new AddressValidationError('Google Maps address validation is temporarily unreachable.', 502)
  }

  const body = await response.json().catch(() => null) as GoogleGeocodeResponse | null
  if (!response.ok) throw new AddressValidationError('Google Maps address validation failed. Try again.', 502)
  if (body?.status === 'ZERO_RESULTS' || !body?.results?.length) {
    throw new AddressValidationError('We could not find that address on Google Maps. Check the street, city and postcode.')
  }
  if (body.status !== 'OK') {
    const detail = body.error_message ? ` ${body.error_message}` : ''
    throw new AddressValidationError(`Google Maps could not validate this address.${detail}`, 502)
  }

  const result = body.results[0]
  if (result.partial_match) {
    throw new AddressValidationError('Google Maps only found a partial match. Enter a more complete street / premise address.')
  }
  const preciseTypes = new Set(['street_address', 'premise', 'subpremise', 'establishment', 'point_of_interest'])
  if (!(result.types ?? []).some((type) => preciseTypes.has(type))) {
    throw new AddressValidationError('Google Maps found only a general street / area. Enter a specific premise or full routable address.')
  }
  const latitude = result.geometry?.location?.lat
  const longitude = result.geometry?.location?.lng
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !result.formatted_address) {
    throw new AddressValidationError('Google Maps returned an incomplete address result.', 502)
  }

  return {
    formattedAddress: result.formatted_address,
    latitude,
    longitude,
    placeId: result.place_id ?? null,
  }
}
