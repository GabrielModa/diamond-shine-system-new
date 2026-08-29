import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { GooglePlacesError, resolveGooglePlace } from '../../../../lib/google-places'
import { resolvePlaceApiAccess } from '../../../../lib/place-access'

const bodySchema = z.object({
  placeId: z.string().trim().min(3).max(256),
  kind: z.enum(['home', 'school']),
  sessionToken: z.string().trim().min(8).max(120).optional(),
}).strict()

export async function POST(request: NextRequest) {
  const access = await resolvePlaceApiAccess(request)
  if (!access) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Choose a valid Google Maps suggestion.' }, { status: 400 })

  try {
    const place = await resolveGooglePlace(parsed.data.placeId, parsed.data.kind, parsed.data.sessionToken)
    return NextResponse.json({ ok: true, data: place })
  } catch (error) {
    if (error instanceof GooglePlacesError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    throw error
  }
}
