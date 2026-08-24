'use client'

import { useEffect, useRef, useState } from 'react'

type Point = { label: string; address: string; latitude: number; longitude: number }
type Site = { id: string; name: string; city: string; addressLine1: string; latitude: number | null; longitude: number | null; client: { displayName: string }; assignedEmployeeIds: string[] }
type Employee = { id: string; name: string; email: string; plannedMinutes: number; actualMinutes: number; completedVisits: number; scheduledVisits: number; sitesServed: number; locationExceptions: number; qualityAverage: number | null; nextDistanceKm: number | null; profile: { home: Point; study?: Point; travelMode: 'driving' | 'transit' | 'cycling' }; nextVisit: { id: string; startsAt: string; site: Site } | null }

type Props = {
  employees: Employee[]
  sites: Site[]
  selectedEmployee: Employee | null
  selectedSite: Site | null
  showEmployees: boolean
  showSites: boolean
  onEmployee: (employee: Employee) => void
  onSite: (site: Site) => void
  routePath?: Array<[number, number]> | null
}

function initials(name: string) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2)
}

export default function CoverageMap({ employees, sites, selectedEmployee, selectedSite, showEmployees, showSites, onEmployee, onSite, routePath }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const layersRef = useRef<import('leaflet').LayerGroup | null>(null)
  const [mapStatus, setMapStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  const recenterMap = () => {
    const map = mapRef.current
    if (!map) return
    map.setView([53.3498, -6.2603], 12, { animate: true })
  }

  useEffect(() => {
    let cancelled = false
    void import('leaflet').then((leafletModule) => {
      if (cancelled || !hostRef.current || mapRef.current) return
      const L = leafletModule.default
      const map = L.map(hostRef.current, { zoomControl: true, scrollWheelZoom: true, preferCanvas: true }).setView([53.3498, -6.2603], 12)
      const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      })
      tiles.on('load', () => { if (!cancelled) setMapStatus('ready') })
      tiles.on('tileerror', () => { if (!cancelled) setMapStatus('unavailable') })
      tiles.addTo(map)
      layersRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      window.setTimeout(() => map.invalidateSize(), 0)
    }).catch(() => { if (!cancelled) setMapStatus('unavailable') })
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      layersRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void import('leaflet').then((leafletModule) => {
      const map = mapRef.current
      const layers = layersRef.current
      if (cancelled || !map || !layers) return
      const L = leafletModule.default
      layers.clearLayers()
      const bounds: [number, number][] = []

      if (showSites) {
        sites.filter((site) => site.latitude != null && site.longitude != null).forEach((site) => {
          const latitude = site.latitude as number
          const longitude = site.longitude as number
          bounds.push([latitude, longitude])
          const selected = site.id === selectedSite?.id
          const marker = L.marker([latitude, longitude], {
            icon: L.divIcon({ className: '', html: `<span class="leaflet-marker leaflet-marker-site${selected ? ' selected' : ''}">⌂</span>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
          }).bindTooltip(`${site.client.displayName} · ${site.name}`, { direction: 'top' })
          marker.on('click', () => onSite(site))
          marker.addTo(layers)
        })
      }

      if (showEmployees) {
        employees.forEach((employee) => {
          const { latitude, longitude } = employee.profile.home
          bounds.push([latitude, longitude])
          const selected = employee.id === selectedEmployee?.id
          const marker = L.marker([latitude, longitude], {
            icon: L.divIcon({ className: '', html: `<span class="leaflet-marker leaflet-marker-person${selected ? ' selected' : ''}">${initials(employee.name)}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] }),
          }).bindTooltip(`${employee.name} · ${employee.profile.home.address}`, { direction: 'top' })
          marker.on('click', () => onEmployee(employee))
          marker.addTo(layers)
        })
      }

      if (selectedEmployee && selectedSite?.latitude != null && selectedSite.longitude != null) {
        const origin: [number, number] = [selectedEmployee.profile.home.latitude, selectedEmployee.profile.home.longitude]
        const destination: [number, number] = [selectedSite.latitude, selectedSite.longitude]
        if (routePath?.length) {
          L.polyline(routePath, { color: '#6754d4', weight: 5, opacity: 0.9, lineCap: 'round' }).addTo(layers)
          map.fitBounds([...routePath, origin, destination], { padding: [48, 48], maxZoom: 14 })
        } else {
          L.polyline([origin, destination], { color: '#8c86aa', weight: 3, opacity: 0.85, dashArray: '8 10', lineCap: 'round' }).addTo(layers)
          map.fitBounds([origin, destination], { padding: [48, 48], maxZoom: 14 })
        }
      } else if (bounds.length) {
        map.fitBounds(bounds, { padding: [38, 38], maxZoom: 13 })
      }
    })
    return () => { cancelled = true }
  }, [employees, onEmployee, onSite, routePath, selectedEmployee, selectedSite, showEmployees, showSites, sites])

  return <div className="coverage-map-shell">
    <div ref={hostRef} className="coverage-map" aria-label="Interactive Dublin workforce coverage map" />
    {mapStatus !== 'ready' ? <div className="map-loading" role="status">{mapStatus === 'loading' ? 'Loading the Dublin map…' : 'Map tiles could not load. Check your connection and retry.'}</div> : null}
    <button type="button" className="map-recenter" onClick={recenterMap} title="Recenter on Dublin" aria-label="Recenter map on Dublin">⌖</button>
    <div className="map-legend"><span><i className="legend-person" /> Team home</span><span><i className="legend-site" /> Service site</span><span><i className={routePath?.length ? 'map-line-key' : 'map-line-key map-line-key--dashed'} />{routePath?.length ? ' Road route' : ' Planning connection'}</span></div>
    <p className="map-context-note">Drag to explore, use +/− to zoom. A dotted line only connects the two points; a solid purple line follows the real road route.</p>
  </div>
}
