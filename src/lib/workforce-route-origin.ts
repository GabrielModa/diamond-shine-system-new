export type RouteOriginMode = 'auto' | 'home' | 'school'
export type RouteOriginPoint = {
  kind: 'home' | 'school'
  label: string
  address: string
  latitude: number | null
  longitude: number | null
}

export function resolveRouteOrigin(
  mode: RouteOriginMode,
  automaticOrigin: RouteOriginPoint | null,
  home: RouteOriginPoint,
  school: RouteOriginPoint | null,
) {
  if (mode === 'home') return home
  if (mode === 'school') return school ?? automaticOrigin ?? home
  return automaticOrigin
}
