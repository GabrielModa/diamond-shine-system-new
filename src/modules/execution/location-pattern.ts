import { prisma } from '../../lib/prisma'
import { distanceInMeters, type Coordinates, type LocationAssessment } from './location'

export const LOCATION_PATTERN_WINDOW_DAYS = 30
export const LOCATION_PATTERN_MIN_OCCURRENCES = 3
export const LOCATION_PATTERN_CLUSTER_RADIUS_M = 175
export const LOCATION_PATTERN_MAX_ACCURACY_M = 100

export type LocationPattern = {
  count: number
  triggered: boolean
  windowDays: number
  clusterRadiusM: number
}

export async function repeatedLocationPattern(input: {
  organizationId: string
  userId: string
  siteId: string
  kind: 'clock_in' | 'clock_out'
  capturedAt: Date
  coordinates: Coordinates
  assessment: LocationAssessment
}): Promise<LocationPattern> {
  const accuracyM = input.assessment.accuracyM
  const latitude = input.coordinates.latitude
  const longitude = input.coordinates.longitude

  if (
    latitude == null
    || longitude == null
    || accuracyM == null
    || accuracyM > LOCATION_PATTERN_MAX_ACCURACY_M
    || input.assessment.risk === 'verified'
  ) {
    return {
      count: 0,
      triggered: false,
      windowDays: LOCATION_PATTERN_WINDOW_DAYS,
      clusterRadiusM: LOCATION_PATTERN_CLUSTER_RADIUS_M,
    }
  }

  const from = new Date(input.capturedAt.getTime() - LOCATION_PATTERN_WINDOW_DAYS * 86_400_000)
  const previous = await prisma.locationEvent.findMany({
    where: {
      organizationId: input.organizationId,
      kind: input.kind,
      capturedAt: { gte: from, lt: input.capturedAt },
      classification: { in: ['near', 'suspicious'] },
      accuracyM: { lte: LOCATION_PATTERN_MAX_ACCURACY_M },
      timeEntry: { is: { userId: input.userId } },
      visit: { is: { siteId: input.siteId } },
    },
    select: { latitude: true, longitude: true },
    orderBy: { capturedAt: 'desc' },
    take: 20,
  })

  const similar = previous.filter((event) => distanceInMeters(
    { latitude, longitude },
    { latitude: Number(event.latitude), longitude: Number(event.longitude) }
  ) <= LOCATION_PATTERN_CLUSTER_RADIUS_M)
  const count = similar.length + 1

  return {
    count,
    triggered: input.assessment.risk === 'watch' && count >= LOCATION_PATTERN_MIN_OCCURRENCES,
    windowDays: LOCATION_PATTERN_WINDOW_DAYS,
    clusterRadiusM: LOCATION_PATTERN_CLUSTER_RADIUS_M,
  }
}
