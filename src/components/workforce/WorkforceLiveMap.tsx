'use client'

import { useEffect, useRef, useState } from 'react'
import type { LiveEmployee } from './live-types'
import styles from './WorkforceLiveNow.module.css'

function initials(name: string) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function markerClass(employee: LiveEmployee) {
  if (employee.attention || employee.state === 'attention') return styles.markerAttention
  if (employee.mapPoint?.kind === 'live_gps') return styles.markerLive
  if (employee.mapPoint?.kind === 'expected_school') return styles.markerSchool
  return styles.markerExpected
}

function ageLabel(seconds: number | null) {
  if (seconds == null) return 'signal time unavailable'
  if (seconds < 60) return `${seconds}s ago`
  return `${Math.round(seconds / 60)} min ago`
}

export default function WorkforceLiveMap({
  employees,
  selectedId,
  onSelect,
}: {
  employees: LiveEmployee[]
  selectedId: string
  onSelect: (employee: LiveEmployee) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<import('leaflet').Map | null>(null)
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  useEffect(() => {
    let cancelled = false
    void import('leaflet').then((module) => {
      if (cancelled || !hostRef.current || mapRef.current) return
      const L = module.default
      const map = L.map(hostRef.current, { zoomControl: true, scrollWheelZoom: true, preferCanvas: true })
        .setView([53.3498, -6.2603], 11)
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
      const mapped = employees.filter((employee) => employee.mapPoint)
      const bounds: Array<[number, number]> = []
      const coordinateUse = new Map<string, number>()

      for (const employee of mapped) {
        const point = employee.mapPoint!
        const key = `${point.latitude.toFixed(5)}:${point.longitude.toFixed(5)}`
        const occurrence = coordinateUse.get(key) ?? 0
        coordinateUse.set(key, occurrence + 1)
        const angle = occurrence * 2.39996
        const radius = occurrence ? Math.min(0.00045, 0.00012 + occurrence * 0.00004) : 0
        const latitude = point.latitude + Math.sin(angle) * radius
        const longitude = point.longitude + Math.cos(angle) * radius
        bounds.push([latitude, longitude])

        const className = [
          styles.markerShell,
          markerClass(employee),
          employee.id === selectedId ? styles.markerSelected : '',
        ].filter(Boolean).join(' ')
        const source = point.kind === 'live_gps'
          ? employee.signal.state === 'fresh'
            ? `Live work GPS · ${ageLabel(employee.signal.ageSeconds)}`
            : `Last known work GPS · ${ageLabel(employee.signal.ageSeconds)}`
          : point.kind === 'expected_school'
            ? 'Expected from study schedule · not live GPS'
            : 'Expected service site · not live GPS'
        const marker = L.marker([latitude, longitude], {
          icon: L.divIcon({
            className,
            html: escapeHtml(initials(employee.name)),
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          }),
        }).bindTooltip(`<strong>${escapeHtml(employee.name)}</strong><br>${escapeHtml(point.label)}<br>${escapeHtml(source)}`, {
          direction: 'top',
        })
        marker.on('click', () => onSelect(employee))
        marker.addTo(layer)
        marker.getElement()?.setAttribute('aria-label', `${employee.name} · ${source}`)
      }

      const selected = mapped.find((employee) => employee.id === selectedId)?.mapPoint
      if (selected) {
        map.setView([selected.latitude, selected.longitude], 13, { animate: true })
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 13, { animate: false })
      } else if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })
      }
    })
    return () => { cancelled = true }
  }, [employees, onSelect, selectedId])

  return <div className={styles.mapShell}>
    <div ref={hostRef} className={styles.map} aria-label="Live workforce operations map" />
    {status !== 'ready' ? <div className={styles.mapState}>{status === 'loading' ? 'Loading live operations map…' : 'Map tiles unavailable.'}</div> : null}
    <div className={styles.legend}>
      <span><i className={styles.live} />Live work GPS</span>
      <span><i className={styles.markerAttention} />Attention</span>
      <span><i className={styles.expected} />Expected visit</span>
      <span><i className={styles.school} />Expected school</span>
    </div>
  </div>
}
