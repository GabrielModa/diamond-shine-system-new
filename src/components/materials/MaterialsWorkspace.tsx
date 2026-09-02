'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import ListControls from '../ui/ListControls'
import StandardSelect from '../ui/StandardSelect'

type Tab = 'overview' | 'count' | 'request' | 'history'
type Site = { id: string; name: string; client: { displayName: string } }
type Material = { id: string; sku: string; name: string; category: string; unit: string; defaultParLevel: number; defaultReorderPoint: number; onHand?: number; parLevel?: number; reorderPoint?: number; state?: 'healthy' | 'low' | 'reorder' | 'out'; lastCountedAt?: string | null; catalogItem?: { name: string } }
type Supply = {
  id: string; siteId?: string | null; clientLocation: string; priority: 'urgent' | 'normal' | 'low'; status: string; dueAt?: string | null; createdAt: string; source?: string; submittedBy?: string; assignedTo?: string | null; notes?: string | null
  items: Array<{ catalogItemId?: string | null; product: string; quantity: number; currentQuantity?: number | null; targetQuantity?: number | null }>
  history?: Array<{ id: string; fromStatus?: string | null; toStatus: string; actorEmail: string; note?: string | null; createdAt: string }>
}
type Control = { summary: { tracked: number; outOfStock: number; needsReorder: number; openRequests: number; overdueRequests: number; sitesWithoutCount: number }; levels: Array<Material & { site: Site; daysRemaining: number | null }>; requests: Supply[] }

const NEXT_STATUS: Record<string, string | undefined> = { Requested: 'Triaged', Triaged: 'Approved', Approved: 'Ordered', Ordered: 'In transit', 'In transit': 'Delivered' }
const CLOSED = new Set(['Delivered', 'Rejected', 'Cancelled'])
function displaySupplyStatus(status: string) { return status === 'InTransit' ? 'In transit' : status }
async function api<T>(url: string, options?: RequestInit): Promise<T> { const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options }); const body = await response.json(); if (!response.ok || !body.ok) throw new Error(body.error ?? 'Something went wrong.'); return body.data as T }

export default function MaterialsWorkspace({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<Tab>(canManage ? 'overview' : 'count')
  const [sites, setSites] = useState<Site[]>([]); const [catalog, setCatalog] = useState<Material[]>([]); const [stock, setStock] = useState<Material[]>([]); const [requests, setRequests] = useState<Supply[]>([]); const [control, setControl] = useState<Control | null>(null)
  const [siteId, setSiteId] = useState(''); const [quantities, setQuantities] = useState<Record<string, string>>({}); const [requestQuantities, setRequestQuantities] = useState<Record<string, number>>({}); const [priority, setPriority] = useState<'urgent' | 'normal' | 'low'>('normal'); const [note, setNote] = useState('')
  const [busy, setBusy] = useState(true); const [saving, setSaving] = useState(false); const [busyRequest, setBusyRequest] = useState<string | null>(null); const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [requestQuery, setRequestQuery] = useState(''); const [requestFrom, setRequestFrom] = useState(''); const [requestTo, setRequestTo] = useState('')

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const [siteData, catalogData, requestData, controlData] = await Promise.all([
        api<Site[]>('/api/sites'), api<Material[]>('/api/materials/catalog'), api<{ items: Supply[] }>(`/api/supplies?limit=100${canManage ? '' : '&mine=true'}`), canManage ? api<Control>('/api/materials/control') : Promise.resolve(null),
      ])
      setSites(siteData); setCatalog(catalogData); setRequests(requestData.items.map((item) => ({ ...item, status: displaySupplyStatus(item.status) }))); setControl(controlData ? { ...controlData, requests: controlData.requests.map((item) => ({ ...item, status: displaySupplyStatus(item.status) })) } : null); setSiteId((current) => current || siteData[0]?.id || '')
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load materials.' }) }
    finally { setBusy(false) }
  }, [canManage])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (!siteId || tab !== 'count') return; void api<Material[]>(`/api/sites/${siteId}/stock`).then((data) => { setStock(data); setQuantities(Object.fromEntries(data.map((item) => [item.id, String(item.onHand ?? 0)]))) }).catch((error) => setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load site stock.' })) }, [siteId, tab])

  const groupedStock = useMemo(() => Object.entries(stock.reduce<Record<string, Material[]>>((groups, item) => { (groups[item.category] ??= []).push(item); return groups }, {})), [stock])
  const selectedRequestItems = Object.entries(requestQuantities).filter(([, quantity]) => quantity > 0)
  const filterRequests = useCallback((items: Supply[]) => { const needle = requestQuery.trim().toLowerCase(); return items.filter((request) => { const date = request.createdAt.slice(0,10); return (!needle || `${request.clientLocation} ${request.status} ${request.priority} ${request.items.map((item) => item.product).join(' ')}`.toLowerCase().includes(needle)) && (!requestFrom || date >= requestFrom) && (!requestTo || date <= requestTo) }) }, [requestFrom, requestQuery, requestTo])
  const visibleRequests = useMemo(() => filterRequests(requests), [filterRequests, requests])
  const visibleControlRequests = useMemo(() => filterRequests(control?.requests ?? []), [control, filterRequests])

  async function submitCount(event: FormEvent) {
    event.preventDefault(); if (!siteId || !stock.length) return; setSaving(true)
    try {
      const result = await api<{ replenishment: Supply | null }>(`/api/sites/${siteId}/stock-counts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'cycle_count', note: note || undefined, lines: stock.map((item) => ({ catalogItemId: item.id, quantity: Math.max(0, Number(quantities[item.id]) || 0) })) }) })
      setMessage({ kind: 'success', text: result.replenishment ? `Count saved. Replenishment ${result.replenishment.id.slice(-6)} created automatically.` : 'Count saved. No duplicate or unnecessary request was created.' }); setNote(''); await refresh(); setTab(canManage ? 'overview' : 'history')
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not save the count.' }) }
    finally { setSaving(false) }
  }
  async function submitRequest(event: FormEvent) {
    event.preventDefault(); if (!siteId || !selectedRequestItems.length) { setMessage({ kind: 'error', text: 'Select a site and at least one material.' }); return }; setSaving(true)
    try { await api('/api/supplies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteId, priority, notes: note || undefined, items: selectedRequestItems.map(([catalogItemId, quantity]) => ({ catalogItemId, quantity })) }) }); setMessage({ kind: 'success', text: 'Material request created and routed to operations.' }); setRequestQuantities({}); setNote(''); await refresh(); setTab('history') }
    catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not create the request.' }) }
    finally { setSaving(false) }
  }
  async function moveRequest(request: Supply, status: string) {
    setBusyRequest(request.id)
    try { await api(`/api/supplies/${request.id}/status`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, note: status === 'Cancelled' ? 'Cancelled from materials control.' : `Moved to ${status} from materials control.` }) }); setMessage({ kind: 'success', text: `${request.clientLocation}: ${status}.` }); await refresh() }
    catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not update request.' }) }
    finally { setBusyRequest(null) }
  }
  function repeatRequest(request: Supply) {
    const next: Record<string, number> = {}
    for (const item of request.items) { const catalogId = item.catalogItemId ?? catalog.find((candidate) => candidate.name === item.product)?.id; if (catalogId) next[catalogId] = item.quantity }
    setRequestQuantities(next); setPriority(request.priority); setNote(request.notes ? `Repeat: ${request.notes}` : `Repeat request ${request.id.slice(-6)}`); if (request.siteId && sites.some((site) => site.id === request.siteId)) setSiteId(request.siteId); setTab('request'); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return <main className="page-shell materials-shell">
    <header className="page-header materials-header"><div><span className="eyebrow">Cleaning materials intelligence</span><h1>Materials control</h1><p className="muted">Count what is actually on site, surface risk early and turn shortages into tracked replenishment.</p></div><button type="button" className="secondary-button" onClick={() => void refresh()} disabled={busy}>↻ Refresh</button></header>
    {message ? <div className={`inline-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}<button type="button" className="notice-close" onClick={() => setMessage(null)} aria-label="Dismiss message">×</button></div> : null}
    <nav className="materials-tabs" aria-label="Materials views">{canManage ? <button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Control centre</button> : null}<button type="button" className={tab === 'count' ? 'active' : ''} onClick={() => setTab('count')}>Count stock</button><button type="button" className={tab === 'request' ? 'active' : ''} onClick={() => setTab('request')}>Request</button><button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>{canManage ? 'Requests' : 'My requests'}</button></nav>
    {busy ? <section className="card empty-state">Loading material intelligence…</section> : null}

    {!busy && tab === 'overview' && control ? <><section className="materials-summary" aria-label="Material summary">{[['Out of stock', control.summary.outOfStock, 'Action now'], ['Reorder', control.summary.needsReorder, 'At or below threshold'], ['Open requests', control.summary.openRequests, `${control.summary.overdueRequests} overdue`], ['Uncounted sites', control.summary.sitesWithoutCount, 'No baseline yet']].map(([label, value, detail]) => <article className="metric-card" key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>)}</section><section className="materials-grid"><article className="card"><div className="section-heading"><div><h2>Risk by location</h2><p className="muted">Only items needing attention.</p></div><span className="section-icon" aria-hidden="true">⚠</span></div><div className="materials-list scroll-list">{control.levels.filter((level) => level.state !== 'healthy').map((level) => <div className="material-row" key={level.id}><span className={`material-state ${level.state}`}>{level.state}</span><div><strong>{level.catalogItem?.name ?? level.name}</strong><small>{level.site.name} · {level.site.client.displayName}</small></div><div className="material-quantity"><strong>{level.onHand}</strong><small>par {level.parLevel}</small></div></div>)}{!control.levels.some((level) => level.state !== 'healthy') ? <p className="muted empty-copy">No tracked shortages.</p> : null}</div></article><article className="card"><div className="section-heading"><div><h2>Replenishment queue</h2><p className="muted">Progress requests here instead of using a disconnected admin screen.</p></div><span className="section-icon violet" aria-hidden="true">↗</span></div><ListControls query={requestQuery} onQueryChange={setRequestQuery} from={requestFrom} to={requestTo} onFromChange={setRequestFrom} onToChange={setRequestTo} placeholder="Search site or material…" onClear={() => { setRequestQuery(''); setRequestFrom(''); setRequestTo('') }} /><RequestList requests={visibleControlRequests} canManage onAdvance={moveRequest} onRepeat={repeatRequest} busyId={busyRequest} /></article></section></> : null}

    {!busy && tab === 'count' ? <form className="card materials-form" onSubmit={submitCount}><div className="section-heading"><div><h2>Fast site count</h2><p className="muted">Enter reality once. Shortages create one request automatically.</p></div></div><SiteSelect sites={sites} siteId={siteId} setSiteId={setSiteId} />{groupedStock.map(([category, items]) => <fieldset className="stock-category" key={category}><legend>{category}</legend>{items.map((item) => <label className="stock-count-row" key={item.id}><span><strong>{item.name}</strong><small>{item.sku} · par {item.parLevel}</small></span><input type="number" min="0" inputMode="numeric" value={quantities[item.id] ?? '0'} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} aria-label={`${item.name} on hand`} /></label>)}</fieldset>)}{!sites.length ? <p className="muted">Create a client site before counting stock.</p> : null}<label>Count note<textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Delivery received, damaged stock, locked cupboard…" /></label><button type="submit" disabled={saving || !stock.length}>{saving ? 'Saving count…' : 'Save count & evaluate replenishment'}</button></form> : null}

    {!busy && tab === 'request' ? <form className="card materials-form" onSubmit={submitRequest}><div className="section-heading"><div><h2>Manual material request</h2><p className="muted">For unexpected needs outside the regular stock count.</p></div></div><SiteSelect sites={sites} siteId={siteId} setSiteId={setSiteId} /><div className="priority-segment" role="group" aria-label="Request priority">{(['urgent','normal','low'] as const).map((item) => <button type="button" key={item} className={`priority-choice ${item} ${priority === item ? 'active' : ''}`} aria-pressed={priority === item} onClick={() => setPriority(item)}><span aria-hidden="true">{item === 'urgent' ? '!' : item === 'normal' ? '•' : '↓'}</span>{item === 'urgent' ? 'Urgent' : item === 'normal' ? 'Normal' : 'Low'}</button>)}</div><div className="request-material-grid">{catalog.map((item) => <label className={requestQuantities[item.id] ? 'selected' : ''} key={item.id}><span><strong>{item.name}</strong><small>{item.category}</small></span><input type="number" min="0" max="999" value={requestQuantities[item.id] ?? 0} onChange={(event) => setRequestQuantities((current) => ({ ...current, [item.id]: Math.max(0, Number(event.target.value) || 0) }))} aria-label={`${item.name} requested quantity`} /></label>)}</div><label>Reason / delivery note<textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label><button type="submit" disabled={saving || !selectedRequestItems.length}>{saving ? 'Creating request…' : `Request ${selectedRequestItems.length || ''} material${selectedRequestItems.length === 1 ? '' : 's'}`}</button></form> : null}

    {!busy && tab === 'history' ? <section className="card"><div className="section-heading"><div><h2>{canManage ? 'Replenishment requests' : 'My requests'}</h2><p className="muted">Visible ownership and progress replace chat follow-ups.</p></div><span className="section-icon" aria-hidden="true">▤</span></div><ListControls query={requestQuery} onQueryChange={setRequestQuery} from={requestFrom} to={requestTo} onFromChange={setRequestFrom} onToChange={setRequestTo} placeholder="Search site, status or material…" onClear={() => { setRequestQuery(''); setRequestFrom(''); setRequestTo('') }} /><RequestList requests={visibleRequests} canManage={canManage} onAdvance={moveRequest} onRepeat={repeatRequest} busyId={busyRequest} /></section> : null}
  </main>
}

function SiteSelect({ sites, siteId, setSiteId }: { sites: Site[]; siteId: string; setSiteId: (value: string) => void }) {
  return <div className="materials-select-field"><span>Client site</span><StandardSelect searchable={sites.length > 8} value={siteId} onChange={setSiteId} ariaLabel="Client site" placeholder="Select site" searchPlaceholder="Search client or site…" options={sites.map((site) => ({ value: site.id, label: `${site.client.displayName} · ${site.name}` }))} /></div>
}
function RequestList({ requests, canManage, onAdvance, onRepeat, busyId }: { requests: Supply[]; canManage: boolean; onAdvance: (request: Supply, status: string) => Promise<void>; onRepeat: (request: Supply) => void; busyId: string | null }) {
  if (!requests.length) return <p className="muted empty-copy">No requests in this view.</p>
  return <div className="materials-list scroll-list">{requests.map((request) => { const overdue = Boolean(request.dueAt && new Date(request.dueAt) < new Date() && !CLOSED.has(request.status)); const next = NEXT_STATUS[request.status]; return <article className={`request-row${overdue ? ' request-overdue' : ''}`} key={request.id}><div className="request-row-top"><span className={`priority-dot ${request.priority}`} /><strong>{request.clientLocation}</strong><span className={`status-chip supply-${request.status.toLowerCase().replaceAll(' ','-')}`}>{request.status}</span></div><p>{request.items.map((item) => `${item.product} × ${item.quantity}`).join(' · ')}</p><small>{request.source === 'stock_count' ? 'Auto-detected from count' : 'Manual request'} · {new Date(request.createdAt).toLocaleString('en-IE')}{request.assignedTo ? ` · owner ${request.assignedTo}` : ''}{overdue ? ' · OVERDUE' : ''}</small><div className="request-actions">{canManage && next ? <button type="button" className="btn-primary compact" disabled={busyId === request.id} onClick={() => void onAdvance(request, next)}>{busyId === request.id ? 'Updating…' : `Mark ${next}`}</button> : null}{!CLOSED.has(request.status) && request.status === 'Requested' ? <button type="button" className="btn-ghost danger compact" disabled={busyId === request.id} onClick={() => void onAdvance(request, 'Cancelled')}>Cancel</button> : null}<button type="button" className="btn-secondary compact" onClick={() => onRepeat(request)}>Repeat request</button></div>{request.history?.length ? <details className="request-history"><summary>History ({request.history.length})</summary>{request.history.map((event) => <div key={event.id}><b>{event.toStatus}</b><span>{new Date(event.createdAt).toLocaleString('en-IE')} · {event.actorEmail}</span>{event.note ? <small>{event.note}</small> : null}</div>)}</details> : null}</article> })}</div>
}
