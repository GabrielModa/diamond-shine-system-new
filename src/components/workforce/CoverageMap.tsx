'use client'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { schoolScheduleSummary } from '../../lib/workforce-schedule-ui'

type Point = { kind:'home'|'school'; label:string; address:string; latitude:number|null; longitude:number|null }
type Site = { id:string; name:string; city:string; addressLine1:string; latitude:number|null; longitude:number|null; client:{displayName:string}; assignedEmployeeIds:string[]; coverageState:'needs_staff'|'covered'|'no_upcoming'; upcomingVisits:number }
export type MapEmployee = {
  id:string; name:string; email:string
  plannedMinutes:number; actualMinutes:number; periodTargetMinutes:number; remainingCapacityMinutes:number
  capacityStatus:'available'|'near'|'over'
  qualityAverage:number|null;qualityCount:number;qualityLabel:string;qualityBand:'excellent'|'good'|'watch'|'issues'|'none'
  context:{state:'home'|'school'|'personal_leave'|'recurring_unavailability'|'temporary_unavailability';availableForScheduling:boolean;origin:Point|null;schoolHolidayActive:boolean}
  nextVisit:{startsAt:string;site:Site}|null
  profile:{home:Point;school:Point|null;studySchedule:Array<{dayOfWeek:number;startsMinute:number;endsMinute:number}>}
}
type Props = {
  employees:MapEmployee[]; sites:Site[]; selectedEmployee:MapEmployee|null; selectedSite:Site|null
  showEmployees:boolean; showSites:boolean
  siteCoverageFilter?:'all'|'needs_staff'|'covered'
  onEmployee:(e:MapEmployee)=>void; onSite:(s:Site)=>void
  routePath?:Array<[number,number]>|null
  routeOrigin?:Point|null
  originMode?:'auto'|'home'|'school'
  onCloseEmployee?:()=>void
  onCloseSite?:()=>void
  onOriginModeChange?:(mode:'auto'|'home'|'school')=>void
  fullscreenTarget?:RefObject<HTMLElement|null>
  routeMode?:'driving'|'transit'|'cycling'|'walking'; onRouteModeChange?:(mode:'driving'|'transit'|'cycling'|'walking')=>void
  route?:{provider:string;durationSeconds:number;distanceMeters:number}|null; routeError?:string; mapsLink?:string
}
const initials=(name:string)=>name.split(' ').map(p=>p[0]).join('').slice(0,2)
const hours=(m:number)=>`${Math.floor(m/60)}h ${m%60}m`
const siteStateLabel=(state:Site['coverageState'])=>state==='needs_staff'?'Needs staff':state==='covered'?'Covered':'No upcoming visits'
const siteMarkerIcon=(state:Site['coverageState'])=>`<span class="wf-site-marker-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M7 20v-9.5L12 7l5 3.5V20M9.5 20v-5h5v5M5 20h14M9.5 11.5h.01M14.5 11.5h.01"/></svg><b>${state==='needs_staff'?'!':state==='covered'?'✓':'–'}</b></span>`
const SiteSymbol=({state}:{state:Site['coverageState']})=><span className={`wf-site-marker-symbol ${state}`} aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M7 20v-9.5L12 7l5 3.5V20M9.5 20v-5h5v5M5 20h14M9.5 11.5h.01M14.5 11.5h.01"/></svg><b>{state==='needs_staff'?'!':state==='covered'?'✓':'–'}</b></span>

export default function CoverageMap({employees,sites,selectedEmployee,selectedSite,showEmployees,showSites,siteCoverageFilter='all',onEmployee,onSite,routePath,routeOrigin,originMode='auto',onCloseEmployee,onCloseSite,onOriginModeChange,fullscreenTarget,routeMode,onRouteModeChange,route,routeError,mapsLink}:Props){
  const hostRef=useRef<HTMLDivElement>(null)
  const shellRef=useRef<HTMLDivElement>(null)
  const mapRef=useRef<import('leaflet').Map|null>(null)
  const closeEmployeeRef=useRef(onCloseEmployee)
  const closeSiteRef=useRef(onCloseSite)
  const layersRef=useRef<import('leaflet').LayerGroup|null>(null)
  const [status,setStatus]=useState<'loading'|'ready'|'unavailable'>('loading')
  const [expanded,setExpanded]=useState(false)
  const [dismissedSiteId,setDismissedSiteId]=useState<string|null>(null)

  useEffect(()=>{closeEmployeeRef.current=onCloseEmployee},[onCloseEmployee])
  useEffect(()=>{closeSiteRef.current=onCloseSite},[onCloseSite])
  const selectedEmployeeRef=useRef(selectedEmployee)
  useEffect(()=>{selectedEmployeeRef.current=selectedEmployee},[selectedEmployee])
  useEffect(()=>{setDismissedSiteId(null)},[selectedSite?.id])
  useEffect(()=>{const map=mapRef.current;if(!map)return;const timers=[40,180,500].map(delay=>window.setTimeout(()=>map.invalidateSize({animate:false}),delay));return()=>timers.forEach(timer=>window.clearTimeout(timer))},[expanded])
  useEffect(()=>{const onFullscreenChange=()=>{const target=fullscreenTarget?.current??shellRef.current;setExpanded(document.fullscreenElement===target)};document.addEventListener('fullscreenchange',onFullscreenChange);return()=>document.removeEventListener('fullscreenchange',onFullscreenChange)},[fullscreenTarget])
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key!=='Escape')return;const isFullscreen=Boolean(document.fullscreenElement);if(selectedEmployeeRef.current){event.preventDefault();event.stopPropagation();closeEmployeeRef.current?.();return}if(isFullscreen){event.preventDefault();event.stopPropagation();void document.exitFullscreen()}};window.addEventListener('keydown',onKey,true);return()=>window.removeEventListener('keydown',onKey,true)},[])
  const toggleFullscreen=()=>{const target=fullscreenTarget?.current??shellRef.current;if(document.fullscreenElement===target){void document.exitFullscreen();return}const request=target?.requestFullscreen as ((options?:{keyboardLock?:'browser';navigationUI?:'hide'|'show'|'auto'})=>Promise<void>)|undefined;void request?.call(target,{keyboardLock:'browser',navigationUI:'hide'}).catch(()=>{void target?.requestFullscreen?.().catch(()=>setExpanded(false))})}

  useEffect(()=>{let cancelled=false;void import('leaflet').then(m=>{
    if(cancelled||!hostRef.current||mapRef.current)return
    const L=m.default
    const map=L.map(hostRef.current,{zoomControl:true,scrollWheelZoom:true,preferCanvas:true}).setView([53.3498,-6.2603],12)
    map.on('click',()=>{closeEmployeeRef.current?.();closeSiteRef.current?.()})
    const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors',maxZoom:19})
    tiles.on('load',()=>!cancelled&&setStatus('ready'));tiles.on('tileerror',()=>!cancelled&&setStatus('unavailable'));tiles.addTo(map)
    layersRef.current=L.layerGroup().addTo(map);mapRef.current=map;setTimeout(()=>map.invalidateSize(),0)
  }).catch(()=>setStatus('unavailable'));return()=>{cancelled=true;mapRef.current?.remove();mapRef.current=null;layersRef.current=null}},[])

  useEffect(()=>{let cancelled=false;void import('leaflet').then(m=>{
    const map=mapRef.current,layers=layersRef.current;if(cancelled||!map||!layers)return
    const L=m.default;layers.clearLayers();const bounds:[number,number][]=[]
    if(showSites)sites.filter(site=>site.latitude!=null&&site.longitude!=null&&(siteCoverageFilter==='all'||site.coverageState===siteCoverageFilter)).forEach(site=>{
      const lat=site.latitude!,lng=site.longitude!;bounds.push([lat,lng])
      const marker=L.marker([lat,lng],{icon:L.divIcon({className:'',html:`<span class="wf-map-pin wf-site-pin ${site.coverageState}">${siteMarkerIcon(site.coverageState)}</span>`,iconSize:[34,42],iconAnchor:[17,40]})})
        .bindTooltip(`<strong>${site.name}</strong><br>${site.client.displayName} · ${siteStateLabel(site.coverageState)}`,{direction:'top',className:'wf-map-tooltip'})
      marker.on('click',()=>{onSite(site);map.panTo([lat,lng],{animate:true})});marker.addTo(layers)
      marker.getElement()?.setAttribute('aria-label',`Service site ${site.client.displayName} · ${site.name}`)
      marker.getElement()?.setAttribute('data-workforce-site-marker',site.id)
    })
    if(showEmployees)employees.filter(e=>['home','school'].includes(e.context.state)&&e.context.origin?.latitude!=null&&e.context.origin.longitude!=null).forEach(e=>{
      const o=e.id===selectedEmployee?.id?(routeOrigin ?? e.context.origin):e.context.origin!;if(o?.latitude==null||o.longitude==null)return;const lat=o.latitude,lng=o.longitude;bounds.push([lat,lng])
      const cls=e.id===selectedEmployee?.id&&originMode==='school'?'school':e.context.state==='school'?'school':'home'
      const marker=L.marker([lat,lng],{icon:L.divIcon({className:'',html:`<span class="wf-map-pin wf-person-pin ${cls}">${initials(e.name)}</span>`,iconSize:[32,32],iconAnchor:[16,16]})})
        .bindTooltip(`${e.name} · ${e.qualityAverage==null?'No feedback':`★ ${e.qualityAverage.toFixed(1)}`} · ${e.context.state==='school'?'School':'Home'}`,{direction:'top'})
      marker.on('click',()=>{onEmployee(e);map.panTo([lat,lng],{animate:true})});marker.addTo(layers)
      marker.getElement()?.setAttribute('aria-label',`Employee ${e.name}`)
      marker.getElement()?.setAttribute('data-workforce-employee-marker',e.id)
    })
    const o=routeOrigin ?? selectedEmployee?.context.origin
    if(o?.latitude!=null&&o.longitude!=null&&selectedSite?.latitude!=null&&selectedSite.longitude!=null){
      const origin:[number,number]=[o.latitude,o.longitude],dest:[number,number]=[selectedSite.latitude,selectedSite.longitude]
      if(routePath?.length){L.polyline(routePath,{color:'#6754d4',weight:5,opacity:.92,lineCap:'round'}).addTo(layers);map.fitBounds([...routePath,origin,dest],{padding:[56,56],maxZoom:14})}
      else{L.polyline([origin,dest],{color:'#8c86aa',weight:3,opacity:.8,dashArray:'8 10'}).addTo(layers);map.fitBounds([origin,dest],{padding:[56,56],maxZoom:14})}
    }else if(o?.latitude!=null&&o.longitude!=null){
      map.setView([o.latitude,o.longitude],13,{animate:true})
    }else if(bounds.length)map.fitBounds(bounds,{padding:[38,38],maxZoom:13})
  });return()=>{cancelled=true}},[employees,sites,selectedEmployee,selectedSite,showEmployees,showSites,siteCoverageFilter,onEmployee,onSite,routePath,routeOrigin,originMode])

  const activeOriginMode=selectedEmployee&&originMode==='school'&&selectedEmployee.profile.school?'school':selectedEmployee?.context.state==='school'?'school':'home'
  const mapSurface = <div ref={shellRef} className="coverage-map-shell">
    <div ref={hostRef} className="coverage-map" aria-label="Workforce coverage map"/>
    {status!=='ready'?<div className="map-loading">{status==='loading'?'Loading map…':'Map tiles unavailable.'}</div>:null}
    <button className="map-recenter" onClick={()=>mapRef.current?.setView([53.3498,-6.2603],12)}>⌖</button>
    <button type="button" className="map-expand" aria-label={expanded?'Close enlarged map':'Open map large'} onClick={toggleFullscreen}>{expanded?'×':'⤢'}</button>
    <div className="wf-map-legend"><span><i className="person home"/>Home</span><span><i className="person school"/>School</span><span><i className="site needs-staff"><b>!</b></i>Needs staff</span><span><i className="site covered"><b>✓</b></i>Covered</span></div>
    {selectedSite&&dismissedSiteId!==selectedSite.id?<aside className="wf-map-site-card" data-testid="map-site-card">
      <button type="button" className="wf-map-card-close" aria-label="Close selected site" onClick={()=>{setDismissedSiteId(selectedSite.id);onCloseSite?.()}}>×</button>
      <div className="wf-map-site-title"><span className={`wf-site-avatar ${selectedSite.coverageState}`}><SiteSymbol state={selectedSite.coverageState}/></span><div><small>{selectedSite.client.displayName}</small><strong>{selectedSite.name}</strong></div></div>
      <p>{selectedSite.addressLine1}, {selectedSite.city}</p>
      <div className="wf-map-site-meta"><span className={selectedSite.coverageState}>{siteStateLabel(selectedSite.coverageState)}</span><span><b>{selectedSite.upcomingVisits}</b> upcoming</span><span><b>{selectedSite.assignedEmployeeIds.length}</b> assigned</span></div>
      {selectedSite.assignedEmployeeIds.length?<small className="wf-map-site-team">{selectedSite.assignedEmployeeIds.map(id=>employees.find(employee=>employee.id===id)?.name).filter(Boolean).join(' · ')}</small>:<small className="wf-map-site-team warning">No employee assigned to the upcoming visit.</small>}
    </aside>:null}
    {selectedEmployee?.context.origin?<aside className="wf-map-focus-card" data-testid="map-employee-card">
      <button type="button" className="wf-map-card-close" aria-label="Close selected employee" onClick={()=>onCloseEmployee?.()}>×</button>
      <div className="wf-map-focus-top"><span className={`wf-origin-dot ${activeOriginMode}`}/><div><strong>{selectedEmployee.name}</strong><small>{originMode==='auto'?(activeOriginMode==='school'?'Using school origin':selectedEmployee.context.state==='school'?'At school now':'Using home base'):`Route preview · ${originMode}`}</small></div></div>
      <p>{(routeOrigin ?? selectedEmployee.context.origin).address}</p>
      {selectedEmployee.profile.school?<div className="wf-school-strip"><span>School</span><strong>{selectedEmployee.profile.school.label}</strong><small>{schoolScheduleSummary(selectedEmployee.profile.studySchedule)}</small></div>:null}
      <div className="wf-map-focus-stats"><span><b>{hours(selectedEmployee.actualMinutes)}</b> worked</span><span><b>{hours(selectedEmployee.remainingCapacityMinutes)}</b> capacity</span><span className={`quality ${selectedEmployee.qualityBand}`}><b>{selectedEmployee.qualityAverage==null?'—':`★ ${selectedEmployee.qualityAverage.toFixed(1)}`}</b>{selectedEmployee.qualityCount?`${selectedEmployee.qualityCount} feedbacks`:'no feedback'}</span></div>
      <div className="wf-map-origin-inline">
        <span>Route origin</span>
        <div>
          <button className={originMode==='auto'?'active':''} onClick={()=>onOriginModeChange?.('auto')}>Auto</button>
          <button className={originMode==='home'?'active':''} onClick={()=>onOriginModeChange?.('home')}>⌂ Home</button>
          <button disabled={!selectedEmployee.profile.school} className={originMode==='school'?'active':''} onClick={()=>onOriginModeChange?.('school')}>▣ School</button>
        </div>
        <small>{originMode==='auto'?'Uses the real schedule context to choose home or school.':originMode==='home'?'Previewing route from the employee home.':'Previewing route from the registered school.'}</small>
      </div>
      {selectedEmployee.nextVisit?<div className="wf-map-focus-next"><small>Next</small><strong>{selectedEmployee.nextVisit.site.name}</strong><span>{new Date(selectedEmployee.nextVisit.startsAt).toLocaleString('en-IE',{weekday:'short',hour:'2-digit',minute:'2-digit'})}</span></div>:<div className="wf-map-focus-next"><small>Next</small><strong>Open capacity</strong></div>}
      <div className="wf-map-inline-route"><label>Service site<select value={selectedSite?.id??''} onChange={event=>{const next=sites.find(site=>site.id===event.target.value);if(next)onSite(next)}}><option value="">Select service site</option>{sites.map(site=><option key={site.id} value={site.id}>{site.client.displayName} · {site.name}</option>)}</select></label><div className="route-modes">{(['driving','transit','cycling','walking'] as const).map(mode=><button type="button" key={mode} className={routeMode===mode?'active':''} onClick={()=>onRouteModeChange?.(mode)}>{mode==='driving'?'🚗':mode==='transit'?'🚌':mode==='cycling'?'🚲':'🚶'}</button>)}</div>{route?<div className="wf-inline-result"><strong>{Math.max(1,Math.round(route.durationSeconds/60))} min</strong><span>{(route.distanceMeters/1000).toFixed(1)} km · {routeMode}</span>{mapsLink&&mapsLink!=='#'?<a href={mapsLink} target="_blank" rel="noreferrer">Open in Maps ↗</a>:null}</div>:routeError?<small className="muted">{routeError}</small>:null}</div>
    </aside>:null}
  </div>
  return mapSurface
}
