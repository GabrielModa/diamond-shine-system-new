import type { LocationClass, Site } from '@prisma/client'

export type Coordinates = {
  latitude?: number | null
  longitude?: number | null
  accuracyM?: number | null
}

type SiteLocation = Pick<
  Site,
  'latitude' | 'longitude' | 'geofenceVerifiedM' | 'geofenceNearM' | 'geofenceSuspiciousM'
>

export type LocationRisk = 'verified' | 'watch' | 'review'
export type LocationConfidence = 'high' | 'medium' | 'low'

export type LocationAssessment = {
  classification: LocationClass
  distanceM: number | null
  accuracyM: number | null
  confidence: LocationConfidence
  risk: LocationRisk
  reviewRequired: boolean
  reason: 'GPS_UNAVAILABLE' | 'GPS_UNCERTAIN' | 'LOCATION_OUTSIDE_GEOFENCE' | 'LOCATION_FAR_FROM_SITE' | null
}

function radians(value: number) {
  return value * Math.PI / 180
}

function normalizedAccuracy(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value < 0) return null
  return Math.round(value)
}

function confidenceForAccuracy(accuracyM: number | null): LocationConfidence {
  if (accuracyM == null) return 'medium'
  if (accuracyM <= 35) return 'high'
  if (accuracyM <= 100) return 'medium'
  return 'low'
}

export function distanceInMeters(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const earthRadiusM = 6_371_000
  const latitudeDelta = radians(to.latitude - from.latitude)
  const longitudeDelta = radians(to.longitude - from.longitude)
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude))
    * Math.sin(longitudeDelta / 2) ** 2
  return Math.round(earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

/**
 * Operational location policy:
 * - never block work solely because a GPS point is outside the site;
 * - use device accuracy as uncertainty instead of treating every point as exact;
 * - near/uncertain readings are a yellow watch signal, not manager work;
 * - only confidently outside readings become review cases.
 */
export function assessLocation(site: SiteLocation, coordinates: Coordinates): LocationAssessment {
  const accuracyM = normalizedAccuracy(coordinates.accuracyM)
  const confidence = confidenceForAccuracy(accuracyM)

  if (
    coordinates.latitude == null
    || coordinates.longitude == null
    || site.latitude == null
    || site.longitude == null
  ) {
    return {
      classification: 'unavailable',
      distanceM: null,
      accuracyM,
      confidence: 'low',
      risk: 'review',
      reviewRequired: true,
      reason: 'GPS_UNAVAILABLE',
    }
  }

  const distanceM = distanceInMeters(
    { latitude: Number(site.latitude), longitude: Number(site.longitude) },
    { latitude: coordinates.latitude, longitude: coordinates.longitude }
  )

  // The reported point is the centre of an accuracy circle. We only accuse a
  // location of being outside a boundary when even the closest plausible point
  // remains outside that boundary.
  const uncertaintyM = accuracyM ?? 0
  const closestPossibleDistanceM = Math.max(0, distanceM - uncertaintyM)
  const furthestPossibleDistanceM = distanceM + uncertaintyM

  if (furthestPossibleDistanceM <= site.geofenceVerifiedM) {
    return {
      classification: 'verified',
      distanceM,
      accuracyM,
      confidence,
      risk: 'verified',
      reviewRequired: false,
      reason: null,
    }
  }

  if (closestPossibleDistanceM <= site.geofenceNearM) {
    return {
      classification: 'near',
      distanceM,
      accuracyM,
      confidence,
      risk: 'watch',
      reviewRequired: false,
      reason: confidence === 'low' ? 'GPS_UNCERTAIN' : null,
    }
  }

  if (closestPossibleDistanceM <= site.geofenceSuspiciousM) {
    return {
      classification: 'suspicious',
      distanceM,
      accuracyM,
      confidence,
      risk: 'review',
      reviewRequired: true,
      reason: 'LOCATION_OUTSIDE_GEOFENCE',
    }
  }

  return {
    classification: 'suspicious',
    distanceM,
    accuracyM,
    confidence,
    risk: 'review',
    reviewRequired: true,
    reason: 'LOCATION_FAR_FROM_SITE',
  }
}
