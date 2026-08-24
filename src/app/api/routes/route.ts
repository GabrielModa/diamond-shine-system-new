import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '../../../lib/auth'

const coordinate = z.number().finite().min(-90).max(90)
const routeSchema = z.object({
  origin: z.object({ latitude: coordinate, longitude: z.number().finite().min(-180).max(180) }),
  destination: z.object({ latitude: coordinate, longitude: z.number().finite().min(-180).max(180) }),
  mode: z.enum(['driving', 'transit', 'cycling']),
})

type GoogleRoute = {
  duration?: string
  staticDuration?: string
  distanceMeters?: number
  polyline?: { encodedPolyline?: string }
}

function routeProviderError(status: number, message: string | undefined) {
  const normalized = message?.toLowerCase() ?? ''
  const configurationIssue = /api key|permission|not authorized|service.*disabled|api.*enabled|routes api/.test(normalized)

  if (configurationIssue) {
    return 'Google Maps is connected, but this server key is not authorised for Routes API yet. In Google Cloud, allow Routes API for this key and try again.'
  }

  if (status === 429) return 'Google Maps routing is busy right now. Please try again in a moment.'
  return 'Google Maps could not calculate this route. Try another travel mode or open the live route in Google Maps.'
}

function routeProviderCode(status: number, message: string | undefined) {
  const normalized = message?.toLowerCase() ?? ''
  if (/api key|permission|not authorized|service.*disabled|api.*enabled|routes api/.test(normalized)) return 'GOOGLE_AUTHORIZATION'
  if (status === 429) return 'GOOGLE_QUOTA'
  if (status === 400) return 'GOOGLE_INVALID_ROUTE_REQUEST'
  return `GOOGLE_ROUTES_${status}`
}

function secondsFromDuration(value: string | undefined) {
  const match = value?.match(/^(\d+(?:\.\d+)?)s$/)
  return match ? Math.round(Number(match[1])) : null
}

function connectionDiagnostic(error: unknown) {
  const connectionError = error instanceof Error ? error : null
  const cause = connectionError && 'cause' in connectionError
    ? (connectionError as Error & { cause?: unknown }).cause
    : undefined
  const causeDetails = cause && typeof cause === 'object'
    ? cause as { code?: unknown; message?: unknown; hostname?: unknown; syscall?: unknown }
    : null

  return {
    name: connectionError?.name ?? 'UnknownError',
    message: connectionError?.message ?? 'Unknown connection error',
    causeCode: typeof causeDetails?.code === 'string' ? causeDetails.code : undefined,
    causeMessage: typeof causeDetails?.message === 'string' ? causeDetails.message : undefined,
    hostname: typeof causeDetails?.hostname === 'string' ? causeDetails.hostname : undefined,
    syscall: typeof causeDetails?.syscall === 'string' ? causeDetails.syscall : undefined,
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request, ['admin', 'supervisor'])
  if ('response' in auth) return auth.response

  const payload = routeSchema.safeParse(await request.json().catch(() => null))
  if (!payload.success) return NextResponse.json({ ok: false, error: 'Invalid route coordinates.' }, { status: 400 })

  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, code: 'GOOGLE_MAPS_NOT_CONFIGURED', error: 'Google Maps routing has not been configured for this environment.' }, { status: 503 })
  }

  const travelMode = { driving: 'DRIVE', transit: 'TRANSIT', cycling: 'BICYCLE' }[payload.data.mode]
  const body: Record<string, unknown> = {
    origin: { location: { latLng: payload.data.origin } },
    destination: { location: { latLng: payload.data.destination } },
    travelMode,
    languageCode: 'en-IE',
    units: 'METRIC',
    polylineQuality: 'OVERVIEW',
  }
  if (payload.data.mode === 'driving') body.routingPreference = 'TRAFFIC_AWARE'

  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    const result = await response.json().catch(() => null) as { routes?: GoogleRoute[]; error?: { message?: string } } | null
    if (!response.ok || !result?.routes?.[0]) {
      const providerMessage = result?.error?.message
      console.error('Google Routes API request failed', { status: response.status, message: providerMessage })
      return NextResponse.json({
        ok: false,
        code: routeProviderCode(response.status, providerMessage),
        error: routeProviderError(response.status, providerMessage),
      }, { status: 502 })
    }
    const route = result.routes[0]
    const seconds = secondsFromDuration(route.duration) ?? secondsFromDuration(route.staticDuration)
    if (seconds == null || route.distanceMeters == null) return NextResponse.json({ ok: false, error: 'Google Maps returned an incomplete route.' }, { status: 502 })
    return NextResponse.json({ ok: true, data: {
      durationSeconds: seconds,
      distanceMeters: route.distanceMeters,
      encodedPolyline: route.polyline?.encodedPolyline ?? null,
      provider: payload.data.mode === 'driving' ? 'Google Maps traffic-aware route' : 'Google Maps route',
    } })
  } catch (error) {
    console.error('Google Routes API connection failed', connectionDiagnostic(error))
    return NextResponse.json({
      ok: false,
      code: 'GOOGLE_CONNECTION',
      error: 'The server could not reach Google Maps Routes API. Check the API key, Routes API access and the server internet connection, then try again.',
    }, { status: 502 })
  }
}
