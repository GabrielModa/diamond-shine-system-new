import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { autocompleteGooglePlaces, GooglePlacesError } from '../../../../lib/google-places'
import { resolvePlaceApiAccess } from '../../../../lib/place-access'
import { consumeRateLimit, rateLimitKey } from '../../../../lib/rate-limit'

const bodySchema = z.object({
  input: z.string().trim().min(3).max(160),
  kind: z.enum(['home', 'school']),
  sessionToken: z.string().trim().min(8).max(120),
}).strict()

export async function POST(request: NextRequest) {
  const access = await resolvePlaceApiAccess(request)
  if (!access) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Enter at least 3 characters to search Google Maps.' }, { status: 400 })

  const key = await rateLimitKey('places-autocomplete', request.headers, `${access.organizationId}:${access.id}`)
  const limit = await consumeRateLimit(key, { limit: 90, windowSeconds: 5 * 60 })
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many address searches. Wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  try {
    const suggestions = await autocompleteGooglePlaces(parsed.data.input, parsed.data.kind, parsed.data.sessionToken)
    return NextResponse.json({ ok: true, data: suggestions })
  } catch (error) {
    if (error instanceof GooglePlacesError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    throw error
  }
}
