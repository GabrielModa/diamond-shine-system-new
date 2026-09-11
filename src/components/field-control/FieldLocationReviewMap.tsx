'use client'

import { useEffect, useRef, useState } from 'react'
import OpsIcon from '../ui/OpsIcon'

export type ReviewLocationPoint = {
  id: string
  kind: string
  latitude: number
  longitude: number
  accuracyM: number | null
  distanceM: number | null
  classification: string | null
  capturedAt: string
}

export type ReviewSitePoint = {
  name: string
  clientName: string
  address: string
  latitude: number | null
  longitude: number | null
  geofenceVerifiedM: number
}

function pointLabel(kind: string) {
  if (kind === 'clock_in') return 'Clock in'
  if (kind === 'clock_out') return 'Clock out'
  if (kind === 'heartbeat') return 'Presence check'
  if (kind === 'manual_correction') return 'Manual correction'
  return kind.replaceAll('_', ' ')
}

function tone(classification: string | null) {
  if (classification === 'verified') return '#27825d'
  if (classification === 'near') return '#c98b21'
  if (classification === 'suspicious') return '#b64d45'
  return '#687772'
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

export default function FieldLocationReviewMap({
  site,
  points,
  selectedPointId,
  onSelectPoint,
}: {
  site: ReviewSitePoint | null
  points: ReviewLocationPoint[]
  selectedPointId: string | null
  onSelectPoint: (id: string) => void
}) {
  const cardRef = useRef<HTMLElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const onFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === cardRef.current)
      window.setTimeout(() => mapRef.current?.invalidateSize(), 40)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  async function toggleFullscreen() {
    const card = cardRef.current
    if (!card) return
    if (document.fullscreenElement === card) await document.exitFullscreen()
    else await card.requestFullscreen()
  }

  useEffect(() => {
    let cancelled = false
    void import('leaflet').then((module) => {
      if (cancelled || !hostRef.current || mapRef.current) return
      const L = module.default
      const map = L.map(hostRef.current, { zoomControl: true, scrollWheelZoom: true, preferCanvas: true })
        .setView([53.3498, -6.2603], 13)
      const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      })
      tiles.on('load', () => !cancelled && setStatus('ready'))
      tiles.on('tileerror', () => !cancelled && setStatus('unavailable'))
      tiles.addTo(map)
      layerRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      window.setTimeout(() => map.invalidateSize(), 0)
    }).catch(() => setStatus('unavailable'))

    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void import('leaflet').then((module) => {
      const map = mapRef.current
      const layer = layerRef.current
      if (cancelled || !map || !layer) return
      const L = module.default
      layer.clearLayers()
      const bounds: Array<[number, number]> = []

      if (site?.latitude != null && site.longitude != null) {
        const expected: [number, number] = [site.latitude, site.longitude]
        bounds.push(expected)
        L.circle(expected, {
          radius: Math.max(20, site.geofenceVerifiedM),
          color: '#247454',
          fillColor: '#2fa66f',
          fillOpacity: 0.08,
          weight: 2,
        }).bindTooltip(`Verified site area · ${site.geofenceVerifiedM}m`).addTo(layer)

        L.marker(expected, {
          icon: L.divIcon({
            className: 'field-review-site-marker-shell',
            html: '<span class="field-review-site-marker" aria-hidden="true">S</span>',
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          }),
        }).bindTooltip(`<strong>${escapeHtml(site.clientName)} · ${escapeHtml(site.name)}</strong><br>Expected work site<br>${escapeHtml(site.address)}`, {
          direction: 'top',
        }).addTo(layer)
      }

      if (points.length > 1) {
        L.polyline(points.map((point) => [point.latitude, point.longitude] as [number, number]), {
          color: '#596d66',
          weight: 3,
          opacity: 0.55,
          dashArray: '7 8',
        }).addTo(layer)
      }

      for (const point of points) {
        const coordinate: [number, number] = [point.latitude, point.longitude]
        bounds.push(coordinate)
        const selected = point.id === selectedPointId
        const marker = L.circleMarker(coordinate, {
          radius: selected ? 11 : 8,
          color: selected ? '#142b24' : tone(point.classification),
          fillColor: tone(point.classification),
          fillOpacity: 0.92,
          weight: selected ? 4 : 2,
        }).bindTooltip(
          `<strong>${escapeHtml(pointLabel(point.kind))}</strong><br>${point.distanceM == null ? 'Distance unavailable' : `${point.distanceM}m from expected site`}<br>${point.accuracyM == null ? 'GPS accuracy unavailable' : `GPS ±${Math.round(point.accuracyM)}m`}`,
          { direction: 'top' },
        )
        marker.on('click', () => onSelectPoint(point.id))
        marker.addTo(layer)
      }

      const selected = points.find((point) => point.id === selectedPointId)
      if (selected) {
        map.setView([selected.latitude, selected.longitude], Math.max(map.getZoom(), 15), { animate: true })
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 15, { animate: false })
      } else if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [42, 42], maxZoom: 15 })
      }
    })

    return () => { cancelled = true }
  }, [onSelectPoint, points, selectedPointId, site])

  const hasExpected = site?.latitude != null && site.longitude != null
  const hasCaptured = points.length > 0

  return <section ref={cardRef} className="field-review-map-card" aria-labelledby="field-review-map-title">
    <div className="field-review-map-head">
      <div>
        <h3 id="field-review-map-title">Location review map</h3>
        <p>Expected site versus GPS captured during this visit.</p>
      </div>
      <div className="field-review-map-tools">
        <div className="field-review-map-legend" aria-label="Location map legend">
          <span><i className="site" />Expected site</span>
          <span><i className="verified" />Verified</span>
          <span><i className="watch" />Watch</span>
          <span><i className="review" />Review</span>
        </div>
        <button type="button" className="field-review-expand" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Exit full screen map' : 'Expand location map'}>
          <OpsIcon name="expand" size={16} /> {fullscreen ? 'Exit full screen' : 'Expand map'}
        </button>
      </div>
    </div>
    <div className="field-review-map-shell">
      <div ref={hostRef} className="field-review-map" aria-label="Execution location review map" />
      {status !== 'ready' ? <div className="field-review-map-state">{status === 'loading' ? 'Loading location map…' : 'Map tiles unavailable.'}</div> : null}
      {!hasExpected ? <div className="field-review-map-warning">Expected site coordinates are not available for this location.</div> : null}
      {!hasCaptured ? <div className="field-review-map-warning bottom">No captured GPS points are available for this time entry.</div> : null}
    </div>
  </section>
}
