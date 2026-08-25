export type WorkforceTravelMode = 'driving' | 'transit' | 'cycling' | 'walking'

export function googleTravelMode(mode: WorkforceTravelMode) {
  return {
    driving: 'DRIVE',
    transit: 'TRANSIT',
    cycling: 'BICYCLE',
    walking: 'WALK',
  }[mode]
}

export function googleMapsTravelMode(mode: WorkforceTravelMode) {
  return {
    driving: 'driving',
    transit: 'transit',
    cycling: 'bicycling',
    walking: 'walking',
  }[mode]
}
