'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { schoolScheduleSummary } from '../../lib/workforce-schedule-ui'

type Point = { kind:'home'|'school'; label:string; address:string; latitude:number|null; longitude:number|null }
type Site = { id:string; name:string; city:string; addressLine1:string; latitude:number|null; longitude:number|null; client:{displayName:string}; assignedEmployeeIds:string[] }
export type MapEmployee = {
  id:string; name:string; email:string
  plannedMinutes:number; actualMinutes:number; periodTargetMinutes:number; remainingCapacityMinutes:number
  capacityStatus:'available'|'near'|'over'
  qualityAverage:number|null;qualityCount:number;qualityLabel:string;qualityBand:'excellent'|'good'|'watch'|'issues'|'none'
  context:{state:'home'|'school'|'personal_leave'|'recurring_unavailability';availableForScheduling:boolean;origin:Point|null;schoolHolidayActive:boolean}
  nextVisit:{startsAt:string;site:Site}|null
  profile:{home:Point;school:Point|null;studySchedule:Array<{dayOfWeek:number;startsMinute:number;endsMinute:number}>}
}
type Props = {
  employees:MapEmployee[]; sites:Site[]; selectedEmployee:MapEmployee|null; selectedSite:Site|null
  showEmployees:boolean; showSites:boolean
  onEmployee:(e:MapEmployee)=>void; onSite:(s:Site)=>void
  routePath?:Array<[number,number]>|null
  routeOrigin?:Point|null
  originMode?:'auto'|'home'|'school'
  onCloseEmployee?:()=>void
  onOriginModeChange?:(mode:'auto'|'home'|'school')=>void
}
const initials=(name:string)=>name.split(' ').map(p=>p[0]).join('').slice(0,2)
const hours=(m:number)=>`${Math.floor(m/60)}h ${m%60}m`

export default function CoverageMap({employees,sites,selectedEmployee,selectedSite,showEmployees,showSites,onEmployee,onSite,routePath,routeOrigin,originMode='auto',onCloseEmployee,onOriginModeChange}:Props){
  const hostRef=useRef<HTMLDivElement>(null)
  const mapRef=useRef<import('leaflet').Map|null>(null)
  const closeEmployeeRef=useRef(onCloseEmployee)
  const layersRef=useRef<import('leaflet').LayerGroup|null>(null)
  const [status,setStatus]=useState<'loading'|'ready'|'unavailable'>('loading')
  const [expanded,setExpanded]=useState(false)

  useEffect(()=>{closeEmployeeRef.current=onCloseEmployee},[onCloseEmployee])
  useEffect(()=>{const map=mapRef.current;if(!map)return;const timers=[40,180,500].map(delay=>window.setTimeout(()=>map.invalidateSize({animate:false}),delay));return()=>timers.forEach(timer=>window.clearTimeout(timer))},[expanded])
  useEffect(()=>{if(!expanded)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous}},[expanded])
  useEffect(()=>{if(!selectedEmployee)return;const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onCloseEmployee?.()};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[selectedEmployee,onCloseEmployee])

  useEffect(()=>{let cancelled=false;void import('leaflet').then(m=>{
    if(cancelled||!hostRef.current||mapRef.current)return
    const L=m.default
    const map=L.map(hostRef.current,{zoomControl:true,scrollWheelZoom:true,preferCanvas:true}).setView([53.3498,-6.2603],12)
    map.on('click',()=>{closeEmployeeRef.current?.();setExpanded(true)})
    const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors',maxZoom:19})
    tiles.on('load',()=>!cancelled&&setStatus('ready'));tiles.on('tileerror',()=>!cancelled&&setStatus('unavailable'));tiles.addTo(map)
    layersRef.current=L.layerGroup().addTo(map);mapRef.current=map;setTimeout(()=>map.invalidateSize(),0)
  }).catch(()=>setStatus('unavailable'));return()=>{cancelled=true;mapRef.current?.remove();mapRef.current=null;layersRef.current=null}},[])

  useEffect(()=>{let cancelled=false;void import('leaflet').then(m=>{
    const map=mapRef.current,layers=layersRef.current;if(cancelled||!map||!layers)return
    const L=m.default;layers.clearLayers();const bounds:[number,number][]=[]
    if(showSites)sites.filter(s=>s.latitude!=null&&s.longitude!=null).forEach(site=>{
      const lat=site.latitude!,lng=site.longitude!;bounds.push([lat,lng])
      const marker=L.marker([lat,lng],{icon:L.divIcon({className:'',html:`<span class="wf-map-pin wf-site-pin${site.id===selectedSite?.id?' selected':''}">◆</span>`,iconSize:[34,34],iconAnchor:[17,17]})})
        .bindTooltip(`${site.client.displayName} · ${site.name}`,{direction:'top'})
      marker.on('click',()=>{onSite(site);map.panTo([lat,lng],{animate:true})});marker.addTo(layers)
      marker.getElement()?.setAttribute('aria-label',`Service site ${site.client.displayName} · ${site.name}`)
      marker.getElement()?.setAttribute('data-workforce-site-marker',site.id)
    })
    if(showEmployees)employees.filter(e=>e.context.availableForScheduling&&e.context.origin?.latitude!=null&&e.context.origin.longitude!=null).forEach(e=>{
      const o=e.id===selectedEmployee?.id?(routeOrigin ?? e.context.origin):e.context.origin!;if(o?.latitude==null||o.longitude==null)return;const lat=o.latitude,lng=o.longitude;bounds.push([lat,lng])
      const cls=e.id===selectedEmployee?.id&&originMode==='school'?'school':e.context.state==='school'?'school':'home',selected=e.id===selectedEmployee?.id
      const marker=L.marker([lat,lng],{icon:L.divIcon({className:'',html:`<span class="wf-map-pin wf-person-pin ${cls}${selected?' selected':''}">${initials(e.name)}</span>`,iconSize:[40,40],iconAnchor:[20,20]})})
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
  });return()=>{cancelled=true}},[employees,sites,selectedEmployee,selectedSite,showEmployees,showSites,onEmployee,onSite,routePath,routeOrigin,originMode])

  const activeOriginMode=selectedEmployee&&originMode==='school'&&selectedEmployee.profile.school?'school':selectedEmployee?.context.state==='school'?'school':'home'
  const mapSurface = <div className={`coverage-map-shell${expanded?' expanded':''}`}>
    <div ref={hostRef} className="coverage-map" aria-label="Workforce coverage map"/>
    {status!=='ready'?<div className="map-loading">{status==='loading'?'Loading map…':'Map tiles unavailable.'}</div>:null}
    <button className="map-recenter" onClick={()=>mapRef.current?.setView([53.3498,-6.2603],12)}>⌖</button>
    <button type="button" className="map-expand" aria-label={expanded?'Close enlarged map':'Open map large'} onClick={()=>setExpanded((value)=>!value)}>{expanded?'×':'⤢'}</button>
    <div className="wf-map-legend"><span><i className="home"/>Home origin</span><span><i className="school"/>School origin</span><span><i className="site"/>Service site</span></div>
    {selectedEmployee?.context.origin?<aside className="wf-map-focus-card" data-testid="map-employee-card">
      <button type="button" className="wf-map-card-close" aria-label="Close selected employee" onClick={()=>onCloseEmployee?.()}>×</button>
      <div className="wf-map-focus-top"><span className={`wf-origin-dot ${activeOriginMode}`}/><div><strong>{selectedEmployee.name}</strong><small>{originMode==='auto'?(selectedEmployee.context.state==='school'?'At school now':'Using home base'):`Route preview · ${originMode}`}</small></div></div>
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
    </aside>:null}
  </div>
  return expanded && typeof document !== 'undefined' ? createPortal(mapSurface, document.body) : mapSurface
}
