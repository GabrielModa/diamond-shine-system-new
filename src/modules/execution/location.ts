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

export type LocationAssessment = {
  classification: LocationClass
  distanceM: number | null
  reviewRequired: boolean
  reason: 'GPS_UNAVAILABLE' | 'LOCATION_OUTSIDE_GEOFENCE' | 'LOCATION_FAR_FROM_SITE' | null
}

function radians(value: number) {
  return value * Math.PI / 180
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

export function assessLocation(site: SiteLocation, coordinates: Coordinates): LocationAssessment {
  if (
    coordinates.latitude == null
    || coordinates.longitude == null
    || site.latitude == null
    || site.longitude == null
  ) {
    return {
      classification: 'unavailable',
      distanceM: null,
      reviewRequired: true,
      reason: 'GPS_UNAVAILABLE',
    }
  }

  const distanceM = distanceInMeters(
    { latitude: Number(site.latitude), longitude: Number(site.longitude) },
    { latitude: coordinates.latitude, longitude: coordinates.longitude }
  )
  if (distanceM <= site.geofenceVerifiedM) {
    return { classification: 'verified', distanceM, reviewRequired: false, reason: null }
  }
  if (distanceM <= site.geofenceNearM) {
    return { classification: 'near', distanceM, reviewRequired: false, reason: null }
  }
  if (distanceM <= site.geofenceSuspiciousM) {
    return {
      classification: 'suspicious',
      distanceM,
      reviewRequired: true,
      reason: 'LOCATION_OUTSIDE_GEOFENCE',
    }
  }
  return {
    classification: 'suspicious',
    distanceM,
    reviewRequired: true,
    reason: 'LOCATION_FAR_FROM_SITE',
  }
}

