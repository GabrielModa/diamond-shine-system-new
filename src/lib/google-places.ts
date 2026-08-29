export type PlaceSuggestion = {
  placeId: string
  text: string
  mainText: string
  secondaryText: string
  types: string[]
}

export type ResolvedPlace = {
  placeId: string
  displayName: string | null
  formattedAddress: string
  latitude: number
  longitude: number
  types: string[]
}

type AutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string
      text?: { text?: string }
      structuredFormat?: {
        mainText?: { text?: string }
        secondaryText?: { text?: string }
      }
      types?: string[]
    }
  }>
  error?: { message?: string }
}

type PlaceDetailsResponse = {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  types?: string[]
  error?: { message?: string }
}

export class GooglePlacesError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message)
    this.name = 'GooglePlacesError'
  }
}

const EDUCATION_TYPES = new Set([
  'academic_department',
  'educational_institution',
  'preschool',
  'primary_school',
  'school',
  'secondary_school',
  'university',
])

const HOME_TYPES = new Set([
  'street_address',
  'premise',
  'subpremise',
  'establishment',
  'point_of_interest',
])

function key() {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) throw new GooglePlacesError(
    'Google Maps Places is not configured. Add GOOGLE_MAPS_API_KEY and enable Places API (New).',
    503,
  )
  return apiKey
}

export async function autocompleteGooglePlaces(
  input: string,
  kind: 'home' | 'school',
  sessionToken: string,
): Promise<PlaceSuggestion[]> {
  const value = input.trim()
  if (value.length < 3) return []

  if (process.env.PLACES_TEST_MODE === '1') {
    return [{
      placeId: `test-${kind}-${value.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      text: kind === 'school' ? `${value}, Dublin, Ireland` : `${value}, Dublin 8, Ireland`,
      mainText: value,
      secondaryText: 'Dublin, Ireland',
      types: kind === 'school' ? ['school', 'establishment'] : ['street_address'],
    }]
  }

  const body: Record<string, unknown> = {
    input: value,
    sessionToken,
    includedRegionCodes: ['ie'],
    languageCode: 'en',
    regionCode: 'ie',
  }
  if (kind === 'school') {
    body.includedPrimaryTypes = [
      'educational_institution',
      'primary_school',
      'school',
      'secondary_school',
      'university',
    ]
  }

  let response: Response
  try {
    response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key(),
        'X-Goog-FieldMask': [
          'suggestions.placePrediction.placeId',
          'suggestions.placePrediction.text.text',
          'suggestions.placePrediction.structuredFormat.mainText.text',
          'suggestions.placePrediction.structuredFormat.secondaryText.text',
          'suggestions.placePrediction.types',
        ].join(','),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    throw new GooglePlacesError('Google Maps autocomplete is temporarily unreachable.')
  }

  const payload = await response.json().catch(() => null) as AutocompleteResponse | null
  if (!response.ok) {
    const detail = payload?.error?.message
    throw new GooglePlacesError(detail ? `Google Maps autocomplete failed: ${detail}` : 'Google Maps autocomplete failed.')
  }

  return (payload?.suggestions ?? [])
    .map((entry) => entry.placePrediction)
    .filter((prediction): prediction is NonNullable<typeof prediction> => Boolean(prediction?.placeId))
    .slice(0, 5)
    .map((prediction) => ({
      placeId: prediction.placeId!,
      text: prediction.text?.text ?? prediction.structuredFormat?.mainText?.text ?? 'Google Maps result',
      mainText: prediction.structuredFormat?.mainText?.text ?? prediction.text?.text ?? 'Google Maps result',
      secondaryText: prediction.structuredFormat?.secondaryText?.text ?? '',
      types: prediction.types ?? [],
    }))
}

export async function resolveGooglePlace(
  placeId: string,
  kind: 'home' | 'school',
  sessionToken?: string | null,
): Promise<ResolvedPlace> {
  if (process.env.PLACES_TEST_MODE === '1') {
    return {
      placeId,
      displayName: kind === 'school' ? 'Test College' : null,
      formattedAddress: kind === 'school' ? 'Test College, Dublin, Ireland' : '10 Test Street, Dublin 8, Ireland',
      latitude: 53.3478,
      longitude: -6.2597,
      types: kind === 'school' ? ['school', 'establishment'] : ['street_address'],
    }
  }

  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`)
  if (sessionToken) url.searchParams.set('sessionToken', sessionToken)
  url.searchParams.set('languageCode', 'en')
  url.searchParams.set('regionCode', 'ie')

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key(),
        'X-Goog-FieldMask': kind === 'school'
          ? 'id,displayName,formattedAddress,location,types'
          : 'id,formattedAddress,location,types',
      },
      cache: 'no-store',
    })
  } catch {
    throw new GooglePlacesError('Google Maps could not load the selected place.')
  }

  const payload = await response.json().catch(() => null) as PlaceDetailsResponse | null
  if (!response.ok) {
    const detail = payload?.error?.message
    throw new GooglePlacesError(detail ? `Google Maps could not verify the selected place: ${detail}` : 'Google Maps could not verify the selected place.')
  }

  const latitude = payload?.location?.latitude
  const longitude = payload?.location?.longitude
  const formattedAddress = payload?.formattedAddress?.trim()
  const types = payload?.types ?? []

  if (!payload?.id || !formattedAddress || typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new GooglePlacesError('Google Maps returned an incomplete place result.')
  }

  if (kind === 'home' && !types.some((type) => HOME_TYPES.has(type)) && !(types.includes('postal_code') && /\b(?:[A-Z]\d{2}|D6W)\s?[A-Z0-9]{4}\b/i.test(formattedAddress))) {
    throw new GooglePlacesError(
      'Choose a specific address or full Eircode from the Google Maps suggestions.',
      422,
    )
  }

  if (kind === 'school' && !types.some((type) => EDUCATION_TYPES.has(type))) {
    throw new GooglePlacesError('Choose a school, college or university from the Google Maps suggestions.', 422)
  }

  return {
    placeId: payload.id,
    displayName: payload.displayName?.text?.trim() || null,
    formattedAddress,
    latitude,
    longitude,
    types,
  }
}
