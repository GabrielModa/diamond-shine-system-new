'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import DetailDialog from '../ui/DetailDialog'
import ListControls from '../ui/ListControls'
import CoverageMap from './CoverageMap'

type TravelMode = 'driving' | 'transit' | 'cycling'
type Point = { label: string; address: string; latitude: number; longitude: number }
type Site = { id: string; name: string; city: string; addressLine1: string; latitude: number | null; longitude: number | null; client: { displayName: string }; assignedEmployeeIds: string[] }
type Employee = {
  id: string; name: string; email: string; plannedMinutes: number; actualMinutes: number; completedVisits: number; scheduledVisits: number; sitesServed: number; locationExceptions: number; qualityAverage: number | null; nextDistanceKm: number | null
  profile: { home: Point; study?: Point; travelMode: TravelMode }
  nextVisit: { id: string; startsAt: string; site: Site } | null
}
type WorkforceData = { generatedAt: string; range: string; summary: { employees: number; plannedMinutes: number; actualMinutes: number; completedVisits: number; siteCoverage: number }; employees: Employee[]; sites: Site[]; routeProvider: string }
type RouteResult = { durationSeconds: number; distanceMeters: number; encodedPolyline: string | null; provider: string }

const rangeLabels = { week: '7 days', fortnight: '14 days', month: '30 days', quarter: '90 days' } as const
const modeLabels: Record<TravelMode, { label: string; icon: string }> = { driving: { label: 'Drive', icon: '🚗' }, transit: { label: 'Public transport', icon: '🚌' }, cycling: { label: 'Cycle', icon: '🚲' } }

function hours(minutes: number) { return `${Math.floor(minutes / 60)}h ${minutes % 60}m` }
function variance(employee: Employee) { return employee.actualMinutes - employee.plannedMinutes }

function decodePolyline(encoded: string | null) {
  if (!encoded) return null
  const points: Array<[number, number]> = []; let index = 0; let latitude = 0; let longitude = 0
  while (index < encoded.length) {
    let shift = 0; let value = 0; let byte: number
    do { byte = encoded.charCodeAt(index++) - 63; value |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    latitude += value & 1 ? ~(value >> 1) : value >> 1
    shift = 0; value = 0
    do { byte = encoded.charCodeAt(index++) - 63; value |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    longitude += value & 1 ? ~(value >> 1) : value >> 1
    points.push([latitude / 1e5, longitude / 1e5])
  }
  return points
}

async function loadWorkforce(range: keyof typeof rangeLabels) {
  const response = await fetch(`/api/workforce?range=${range}`, { credentials: 'include', cache: 'no-store' })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not load workforce data.')
  return body.data as WorkforceData
}

export default function WorkforceWorkspace() {
  const [data, setData] = useState<WorkforceData | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  const [range, setRange] = useState<keyof typeof rangeLabels>('week'); const [tab, setTab] = useState<'performance' | 'coverage'>('performance'); const [query, setQuery] = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null); const [selectedSite, setSelectedSite] = useState<Site | null>(null); const [showEmployees, setShowEmployees] = useState(true); const [showSites, setShowSites] = useState(true); const [routeMode, setRouteMode] = useState<TravelMode>('driving'); const [route, setRoute] = useState<RouteResult | null>(null); const [routeError, setRouteError] = useState(''); const [routeLoading, setRouteLoading] = useState(false)
  const refresh = useCallback(async () => { setLoading(true); setError(''); try { setData(await loadWorkforce(range)) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load workforce data.') } finally { setLoading(false) } }, [range])
  useEffect(() => { void refresh() }, [refresh])
  const employees = useMemo(() => data?.employees.filter((employee) => `${employee.name} ${employee.email} ${employee.profile.home.address} ${employee.nextVisit?.site.name ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [data, query])
  const sites = useMemo(() => data?.sites.filter((site) => `${site.name} ${site.client.displayName} ${site.addressLine1}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [data, query])
  const mapsLink = selectedEmployee && selectedSite?.latitude != null && selectedSite.longitude != null ? `https://www.google.com/maps/dir/?api=1&origin=${selectedEmployee.profile.home.latitude},${selectedEmployee.profile.home.longitude}&destination=${selectedSite.latitude},${selectedSite.longitude}&travelmode=${routeMode === 'transit' ? 'transit' : routeMode === 'cycling' ? 'bicycling' : 'driving'}` : '#'
  const routePath = useMemo(() => decodePolyline(route?.encodedPolyline ?? null), [route?.encodedPolyline])
  useEffect(() => {
    if (!selectedEmployee || selectedSite?.latitude == null || selectedSite.longitude == null) { setRoute(null); setRouteError(''); setRouteLoading(false); return }
    let cancelled = false
    const loadRoute = async () => {
      setRouteLoading(true); setRoute(null); setRouteError('')
      try {
        const response = await fetch('/api/routes', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: selectedEmployee.profile.home, destination: { latitude: selectedSite.latitude, longitude: selectedSite.longitude }, mode: routeMode }) })
        const body = await response.json()
          if (!response.ok || !body.ok) {
            const diagnostic = typeof body.code === 'string' ? ` [${body.code}]` : ''
            throw new Error(`${body.error ?? 'Google Maps could not calculate this route.'}${diagnostic}`)
          }
        if (!cancelled) setRoute(body.data as RouteResult)
      } catch (cause) { if (!cancelled) setRouteError(cause instanceof Error ? cause.message : 'Google Maps could not calculate this route.') } finally { if (!cancelled) setRouteLoading(false) }
    }
    void loadRoute()
    return () => { cancelled = true }
  }, [routeMode, selectedEmployee, selectedSite])

  return <main className="page-shell workforce-page">
    <header className="workforce-hero"><div><span className="eyebrow">Workforce intelligence</span><h1>People, capacity & coverage</h1><p>Balance the team using planned work, verified hours, location context and travel-ready coverage decisions.</p></div><button className="btn-secondary" onClick={() => void refresh()} disabled={loading}>↻ Refresh</button></header>
    {error ? <div className="toast error" role="alert">{error}</div> : null}
    <nav className="workforce-tabs" aria-label="Workforce views"><button className={tab === 'performance' ? 'active' : ''} onClick={() => setTab('performance')}>◷ Team performance</button><button className={tab === 'coverage' ? 'active' : ''} onClick={() => setTab('coverage')}>⌖ Coverage & routing</button></nav>
    <section className="workforce-toolbar card"><div className="range-control" aria-label="Reporting period">{(Object.keys(rangeLabels) as Array<keyof typeof rangeLabels>).map((value) => <button key={value} aria-label={`Last ${rangeLabels[value]}`} title={`Last ${rangeLabels[value]}`} className={range === value ? 'active' : ''} onClick={() => setRange(value)}>{rangeLabels[value]}</button>)}</div><ListControls query={query} onQueryChange={setQuery} placeholder={tab === 'performance' ? 'Search team member, location or next site…' : 'Search employee or site…'} onClear={() => setQuery('')} /></section>
    {loading && !data ? <section className="card empty-state">Building the workforce picture…</section> : null}
    {data && tab === 'performance' ? <>
      <section className="workforce-kpis"><article><span className="section-icon violet">♟</span><div><small>Active team</small><strong>{data.summary.employees}</strong><p>People with current operational access</p></div></article><article><span className="section-icon">◷</span><div><small>Actual / planned</small><strong>{hours(data.summary.actualMinutes)} <em>/ {hours(data.summary.plannedMinutes)}</em></strong><p>Logged hours compared with assigned work</p></div></article><article><span className="section-icon green">✓</span><div><small>Completed visits</small><strong>{data.summary.completedVisits}</strong><p>Completed work in the selected period</p></div></article><article><span className="section-icon amber">⌂</span><div><small>Covered sites</small><strong>{data.summary.siteCoverage}</strong><p>Upcoming location coverage visible</p></div></article></section>
      <section className="card workforce-table-card"><div className="section-heading"><div><h2>Capacity ranking</h2><p className="muted">Ranked by recorded workload. Open a profile for the context behind every number.</p></div><span className="count-pill">{employees.length}</span></div><div className="workforce-table scroll-list" role="table"><div className="workforce-row workforce-head" role="row"><span>Team member</span><span>Actual / planned</span><span>Visits</span><span>Sites</span><span>Quality</span><span>Exceptions</span></div>{employees.map((employee, index) => <button type="button" role="row" key={employee.id} className="workforce-row" onClick={() => setSelectedEmployee(employee)}><span className="employee-cell"><b className="rank-number">#{index + 1}</b><span className="employee-avatar">{employee.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><strong>{employee.name}<small>{employee.profile.home.address}</small></strong></span><span><b>{hours(employee.actualMinutes)}</b><small className={variance(employee) > 30 ? 'warning-text' : ''}>{variance(employee) >= 0 ? '+' : ''}{hours(Math.abs(variance(employee)))} vs plan</small></span><span><b>{employee.completedVisits}</b><small>{employee.scheduledVisits} assigned</small></span><span>{employee.sitesServed}</span><span>{employee.qualityAverage == null ? '—' : `${employee.qualityAverage}/5`}</span><span className={employee.locationExceptions ? 'warning-text' : ''}>{employee.locationExceptions || 'Clear'}</span></button>)}{!employees.length ? <div className="empty-state">No team members match this filter.</div> : null}</div></section>
    </> : null}
    {data && tab === 'coverage' ? <section className="coverage-layout"><div className="coverage-panel card"><div className="section-heading"><div><span className="eyebrow">Live coverage map</span><h2>Assign with travel context</h2><p className="muted">Use the real map to pan, zoom and select a person or location before checking the route.</p></div></div><div className="coverage-toggles"><button className={showEmployees ? 'active' : ''} onClick={() => setShowEmployees((value) => !value)}>● Team homes</button><button className={showSites ? 'active' : ''} onClick={() => setShowSites((value) => !value)}>⌂ Service sites</button></div><CoverageMap employees={employees} sites={sites} selectedEmployee={selectedEmployee} selectedSite={selectedSite} showEmployees={showEmployees} showSites={showSites} onEmployee={setSelectedEmployee} onSite={setSelectedSite} routePath={routePath} /></div><aside className="route-planner card"><span className="eyebrow">Route planner</span><h2>Match person to place</h2><label>Team member<select value={selectedEmployee?.id ?? ''} onChange={(event) => setSelectedEmployee(data.employees.find((employee) => employee.id === event.target.value) ?? null)}><option value="">Select team member</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.profile.home.address}</option>)}</select></label><label>Service location<select value={selectedSite?.id ?? ''} onChange={(event) => setSelectedSite(data.sites.find((site) => site.id === event.target.value) ?? null)}><option value="">Select service site</option>{data.sites.map((site) => <option key={site.id} value={site.id}>{site.client.displayName} · {site.name}</option>)}</select></label>{selectedEmployee ? <article className="route-origin"><span>Starting point</span><strong>{selectedEmployee.profile.home.address}</strong>{selectedEmployee.profile.study ? <small>Study: {selectedEmployee.profile.study.address}</small> : null}</article> : null}<div className="route-modes">{(Object.keys(modeLabels) as TravelMode[]).map((mode) => <button key={mode} className={routeMode === mode ? 'active' : ''} onClick={() => setRouteMode(mode)}>{modeLabels[mode].icon} {modeLabels[mode].label}</button>)}</div>{routeLoading ? <div className="route-empty">Calculating the Google Maps route…</div> : null}{route ? <article className="route-result"><span>{route.provider}</span><strong>{Math.max(1, Math.round(route.durationSeconds / 60))} min</strong><p>{(route.distanceMeters / 1000).toFixed(1)} km · actual road route</p><a href={mapsLink} target="_blank" rel="noreferrer" className="btn-primary">Open live route in Google Maps ↗</a></article> : null}{routeError ? <article className="route-empty route-config"><strong>Google Maps route required</strong><p>{routeError}</p><a href={mapsLink} target="_blank" rel="noreferrer" className="btn-secondary">Open this route in Google Maps ↗</a></article> : null}{!routeLoading && !route && !routeError ? <div className="route-empty">Select one team member and one service site to calculate the real route.</div> : null}<small className="route-disclaimer">Routes and durations come from Google Maps once the server key is configured. No straight-line estimate is used.</small></aside></section> : null}
    <DetailDialog open={Boolean(selectedEmployee && tab === 'performance')} title={selectedEmployee?.name ?? 'Team member'} eyebrow="Manager-only workforce profile" onClose={() => setSelectedEmployee(null)}>{selectedEmployee ? <div className="employee-profile-dialog"><section className="employee-profile-summary"><span className="employee-avatar large">{selectedEmployee.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><div><h3>{selectedEmployee.name}</h3><p>{selectedEmployee.email}</p><span className="profile-role">{modeLabels[selectedEmployee.profile.travelMode].icon} Usually travels by {modeLabels[selectedEmployee.profile.travelMode].label.toLowerCase()}</span></div></section><section className="profile-stat-grid"><article><span>Recorded</span><strong>{hours(selectedEmployee.actualMinutes)}</strong></article><article><span>Planned</span><strong>{hours(selectedEmployee.plannedMinutes)}</strong></article><article><span>Completed visits</span><strong>{selectedEmployee.completedVisits}</strong></article><article><span>Quality</span><strong>{selectedEmployee.qualityAverage ?? '—'}{selectedEmployee.qualityAverage != null ? '/5' : ''}</strong></article></section><section className="profile-location-card"><h3>Planning locations</h3><div><span>⌂ Home base</span><strong>{selectedEmployee.profile.home.address}</strong></div>{selectedEmployee.profile.study ? <div><span>▣ Study location</span><strong>{selectedEmployee.profile.study.address}</strong></div> : null}<small>For manager planning only. Use consented, current employee data in production.</small></section>{selectedEmployee.nextVisit ? <section className="profile-next-visit"><span>Next visible assignment</span><strong>{selectedEmployee.nextVisit.site.client.displayName} · {selectedEmployee.nextVisit.site.name}</strong><p>{new Date(selectedEmployee.nextVisit.startsAt).toLocaleString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {selectedEmployee.nextDistanceKm ?? '—'} km from home base</p><button className="btn-secondary" onClick={() => { setSelectedSite(selectedEmployee.nextVisit!.site); setTab('coverage') }}>Plan this route →</button></section> : null}</div> : null}</DetailDialog>
  </main>
}
