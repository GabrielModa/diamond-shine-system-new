'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupplyPriority, SupplyRequest, SupplyStatus } from '../../types'
import { isSupplyOverdue } from '../../lib/business-logic'
import { clientApi } from '../../lib/client-api'
import ListControls from '../ui/ListControls'
import StandardSelect from '../ui/StandardSelect'
import SupplyOperationsOverview from './SupplyOperationsOverview'
import { SupplyDetailSheet } from '../dashboard/SupplyDetailSheet'
import { EmailModal } from '../dashboard/EmailModal'
import { ConfirmModal } from '../dashboard/ConfirmModal'
import OpsIcon from '../ui/OpsIcon'

type Tab = 'overview' | 'count' | 'request' | 'history'
type Site = { id: string; name: string; client: { displayName: string } }
type Material = { id: string; sku: string; name: string; category: string; unit: string; defaultParLevel: number; defaultReorderPoint: number; onHand?: number; parLevel?: number; reorderPoint?: number; state?: 'healthy' | 'low' | 'reorder' | 'out'; lastCountedAt?: string | null; catalogItem?: { name: string } }
type Supply = SupplyRequest & {
  siteId?: string | null
  source?: string
  items: Array<{ catalogItemId?: string | null; product: string; quantity: number; currentQuantity?: number | null; targetQuantity?: number | null }>
}
type Assignee = { email: string; name: string | null; role: string; status: string }
type SupplyFilter = { status?: SupplyStatus; priority?: SupplyPriority; preset?: 'all' | 'overdue' | 'unassigned' | 'month' }
type Control = { summary: { tracked: number; outOfStock: number; needsReorder: number; openRequests: number; overdueRequests: number; sitesWithoutCount: number }; levels: Array<Material & { site: Site; daysRemaining: number | null }>; requests: Supply[] }
type SuppliesBootstrap = { sites: Site[]; catalog: Material[]; requests: Supply[]; control: Control | null; assignees: Assignee[] }
type RepeatDraft = {
  location?: string
  priority?: 'urgent' | 'normal' | 'low'
  notes?: string
  selected?: string[]
  quantities?: Record<string, number>
}

const NEXT_STATUS: Record<string, string | undefined> = { Requested: 'Triaged', Triaged: 'Approved', Approved: 'Ordered', Ordered: 'In transit', 'In transit': 'Delivered' }
const CLOSED = new Set(['Delivered', 'Rejected', 'Cancelled'])
function displaySupplyStatus(status: string) { return status === 'InTransit' ? 'In transit' : status }
const api = clientApi

export default function MaterialsWorkspace({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<Tab>(canManage ? 'overview' : 'count')
  const [sites, setSites] = useState<Site[]>([]); const [catalog, setCatalog] = useState<Material[]>([]); const [stock, setStock] = useState<Material[]>([]); const [requests, setRequests] = useState<Supply[]>([]); const [control, setControl] = useState<Control | null>(null)
  const [siteId, setSiteId] = useState(''); const [quantities, setQuantities] = useState<Record<string, string>>({}); const [requestQuantities, setRequestQuantities] = useState<Record<string, number>>({}); const [priority, setPriority] = useState<'urgent' | 'normal' | 'low'>('normal'); const [note, setNote] = useState('')
  const [busy, setBusy] = useState(true); const [saving, setSaving] = useState(false); const [busyRequest, setBusyRequest] = useState<string | null>(null); const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [requestQuery, setRequestQuery] = useState(''); const [requestFrom, setRequestFrom] = useState(''); const [requestTo, setRequestTo] = useState('')
  const [supplyFilter, setSupplyFilter] = useState<SupplyFilter>({})
  const [selectedRequest, setSelectedRequest] = useState<Supply | null>(null)
  const [emailRequest, setEmailRequest] = useState<Supply | null>(null)
  const [confirmTransition, setConfirmTransition] = useState<{ request: Supply; status: SupplyStatus } | null>(null)
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const repeatDraftChecked = useRef(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const bootstrap = await api<SuppliesBootstrap>('/api/supplies/bootstrap')
      setSites(bootstrap.sites)
      setCatalog(bootstrap.catalog)
      setRequests(bootstrap.requests.map((item) => ({ ...item, status: displaySupplyStatus(item.status) as SupplyStatus })))
      setControl(bootstrap.control ? { ...bootstrap.control, requests: bootstrap.control.requests.map((item) => ({ ...item, status: displaySupplyStatus(item.status) as SupplyStatus })) } : null)
      setAssignees(bootstrap.assignees.filter((item) => item.status === 'active'))

      let repeated = false
      if (!repeatDraftChecked.current) {
        repeatDraftChecked.current = true
        const rawDraft = window.localStorage.getItem('ds-supplies-draft')
        if (rawDraft) {
          try {
            const draft = JSON.parse(rawDraft) as RepeatDraft
            const location = draft.location?.trim().toLowerCase()
            const repeatedSite = location
              ? bootstrap.sites.find((site) => site.name.trim().toLowerCase() === location)
              : undefined
            const selectedProducts = draft.selected ?? []
            const nextQuantities: Record<string, number> = {}
            let completeMaterialMatch = selectedProducts.length > 0
            for (const product of selectedProducts) {
              const material = bootstrap.catalog.find((item) => item.name.trim().toLowerCase() === product.trim().toLowerCase())
              const quantity = Math.max(0, Number(draft.quantities?.[product] ?? 1) || 0)
              if (!material || quantity <= 0) {
                completeMaterialMatch = false
                continue
              }
              nextQuantities[material.id] = quantity
            }

            if (repeatedSite && completeMaterialMatch && Object.keys(nextQuantities).length === selectedProducts.length) {
              setSiteId(repeatedSite.id)
              setRequestQuantities(nextQuantities)
              if (draft.priority && ['urgent', 'normal', 'low'].includes(draft.priority)) setPriority(draft.priority)
              setNote(draft.notes ?? '')
              setTab('request')
              window.localStorage.removeItem('ds-supplies-draft')
              repeated = true
            } else {
              window.localStorage.removeItem('ds-supplies-draft')
              setMessage({
                kind: 'error',
                text: 'This previous request can no longer be repeated exactly because its location or materials are no longer available.',
              })
            }
          } catch {
            window.localStorage.removeItem('ds-supplies-draft')
            setMessage({ kind: 'error', text: 'The saved repeat request could not be restored.' })
          }
        }
      }
      if (!repeated) setSiteId((current) => current || bootstrap.sites[0]?.id || '')
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load materials.' }) }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (!siteId || tab !== 'count') return; void api<Material[]>(`/api/sites/${siteId}/stock`).then((data) => { setStock(data); setQuantities(Object.fromEntries(data.map((item) => [item.id, String(item.onHand ?? 0)]))) }).catch((error) => setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load site stock.' })) }, [siteId, tab])

  const groupedStock = useMemo(() => Object.entries(stock.reduce<Record<string, Material[]>>((groups, item) => { (groups[item.category] ??= []).push(item); return groups }, {})), [stock])
  const selectedRequestItems = Object.entries(requestQuantities).filter(([, quantity]) => quantity > 0)
  const filterRequests = useCallback((items: Supply[]) => { const needle = requestQuery.trim().toLowerCase(); return items.filter((request) => { const date = request.createdAt.slice(0,10); return (!needle || `${request.employeeName} ${request.clientLocation} ${request.status} ${request.priority} ${request.items.map((item) => item.product).join(' ')}`.toLowerCase().includes(needle)) && (!requestFrom || date >= requestFrom) && (!requestTo || date <= requestTo) }) }, [requestFrom, requestQuery, requestTo])
  const applySupplyFilter = useCallback((items: Supply[]) => items.filter((request) => {
    if (supplyFilter.status && request.status !== supplyFilter.status) return false
    if (supplyFilter.priority && request.priority !== supplyFilter.priority) return false
    if (supplyFilter.preset === 'overdue' && !isSupplyOverdue(request.dueAt, request.status)) return false
    if (supplyFilter.preset === 'unassigned' && (request.assignedTo || CLOSED.has(request.status))) return false
    if (supplyFilter.preset === 'month') {
      const date = new Date(request.createdAt)
      const now = new Date()
      if (date.getMonth() !== now.getMonth() || date.getFullYear() !== now.getFullYear()) return false
    }
    return true
  }), [supplyFilter])
  const visibleRequests = useMemo(() => applySupplyFilter(filterRequests(requests)), [applySupplyFilter, filterRequests, requests])
  const visibleControlRequests = visibleRequests

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
  async function assignRequest(request: Supply, assigneeEmail: string | null) {
    setBusyRequest(request.id)
    try {
      const result = await api<{ id: string; assignedTo: string | null }>(`/api/supplies/${request.id}/assign`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assigneeEmail }),
      })
      setRequests((current) => current.map((item) => item.id === result.id ? { ...item, assignedTo: result.assignedTo ?? undefined } : item))
      setSelectedRequest((current) => current?.id === result.id ? { ...current, assignedTo: result.assignedTo ?? undefined } : current)
      setMessage({ kind: 'success', text: result.assignedTo ? 'Responsible person assigned.' : 'Request unassigned.' })
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not assign request.' })
    } finally {
      setBusyRequest(null)
    }
  }

  async function notifyClient(payload: { clientEmail: string; subject: string; htmlBody: string }) {
    if (!emailRequest) return
    setBusyRequest(emailRequest.id)
    try {
      await api(`/api/supplies/${emailRequest.id}/notify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setMessage({ kind: 'success', text: 'Client email queued for delivery.' })
      setEmailRequest(null)
      await refresh()
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not queue client email.' })
    } finally {
      setBusyRequest(null)
    }
  }

  function repeatRequest(request: Supply) {
    const next: Record<string, number> = {}
    for (const item of request.items) { const catalogId = item.catalogItemId ?? catalog.find((candidate) => candidate.name === item.product)?.id; if (catalogId) next[catalogId] = item.quantity }
    setRequestQuantities(next); setPriority(request.priority); setNote(request.notes ? `Repeat: ${request.notes}` : `Repeat request ${request.id.slice(-6)}`); if (request.siteId && sites.some((site) => site.id === request.siteId)) setSiteId(request.siteId); setTab('request'); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return <main className="page-shell materials-shell">
    <header className="page-header materials-header"><div><span className="eyebrow">Requests, procurement & stock</span><h1>Supplies</h1><p className="muted">Process requests from the field, keep stock reality current and see shortages before they disrupt service.</p></div><button type="button" className="secondary-button" onClick={() => void refresh()} disabled={busy}><OpsIcon name="refresh" size={16} /> Refresh</button></header>
    {message ? <div className={`inline-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}<button type="button" className="notice-close" onClick={() => setMessage(null)} aria-label="Dismiss message">×</button></div> : null}
    <nav className="materials-tabs" aria-label="Supplies views">{canManage ? <button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Requests & stock</button> : null}<button type="button" className={tab === 'count' ? 'active' : ''} onClick={() => setTab('count')}>Count stock</button><button type="button" className={tab === 'request' ? 'active' : ''} onClick={() => setTab('request')}>New request</button><button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>{canManage ? 'Request history' : 'My requests'}</button></nav>
    {busy ? <section className="card empty-state">Loading material intelligence…</section> : null}

    {!busy && tab === 'overview' && control ? <><SupplyOperationsOverview requests={requests} filter={supplyFilter} onFilter={(filter) => { setSupplyFilter(filter); setRequestQuery(''); setRequestFrom(''); setRequestTo('') }} /><section className="materials-summary" aria-label="Stock health summary">{[['Out of stock', control.summary.outOfStock, 'Action now'], ['Reorder', control.summary.needsReorder, 'At or below threshold'], ['Open requests', control.summary.openRequests, `${control.summary.overdueRequests} overdue`], ['Uncounted sites', control.summary.sitesWithoutCount, 'No baseline yet']].map(([label, value, detail]) => <article className="metric-card" key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>)}</section><section className="materials-grid"><article className="card"><div className="section-heading"><div><h2>Risk by location</h2><p className="muted">Only items needing attention.</p></div><span className="section-icon" aria-hidden="true">⚠</span></div><div className="materials-list scroll-list">{control.levels.filter((level) => level.state !== 'healthy').map((level) => <div className="material-row" key={level.id}><span className={`material-state ${level.state}`}>{level.state}</span><div><strong>{level.catalogItem?.name ?? level.name}</strong><small>{level.site.name} · {level.site.client.displayName}</small></div><div className="material-quantity"><strong>{level.onHand}</strong><small>par {level.parLevel}</small></div></div>)}{!control.levels.some((level) => level.state !== 'healthy') ? <p className="muted empty-copy">No tracked shortages.</p> : null}</div></article><article className="card"><div className="section-heading"><div><h2>Request queue</h2><p className="muted">Open a request to assign ownership, notify the client or move it through procurement.</p></div><span className="section-icon violet" aria-hidden="true">↗</span></div><ListControls query={requestQuery} onQueryChange={setRequestQuery} from={requestFrom} to={requestTo} onFromChange={setRequestFrom} onToChange={setRequestTo} placeholder="Search site or material…" onClear={() => { setRequestQuery(''); setRequestFrom(''); setRequestTo('') }} /><RequestList requests={visibleControlRequests} canManage={canManage} onAdvance={moveRequest} onRepeat={repeatRequest} onOpen={setSelectedRequest} busyId={busyRequest} /></article></section></> : null}

    {!busy && tab === 'count' ? <form className="card materials-form" onSubmit={submitCount}><div className="section-heading"><div><h2>Fast site count</h2><p className="muted">Enter reality once. Shortages create one request automatically.</p></div></div><SiteSelect sites={sites} siteId={siteId} setSiteId={setSiteId} />{groupedStock.map(([category, items]) => <fieldset className="stock-category" key={category}><legend>{category}</legend>{items.map((item) => <label className="stock-count-row" key={item.id}><span><strong>{item.name}</strong><small>{item.sku} · par {item.parLevel}</small></span><input type="number" min="0" inputMode="numeric" value={quantities[item.id] ?? '0'} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} aria-label={`${item.name} on hand`} /></label>)}</fieldset>)}{!sites.length ? <p className="muted">Create a client site before counting stock.</p> : null}<label>Count note<textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Delivery received, damaged stock, locked cupboard…" /></label><button type="submit" disabled={saving || !stock.length}>{saving ? 'Saving count…' : 'Save count & evaluate replenishment'}</button></form> : null}

    {!busy && tab === 'request' ? <form className="card materials-form" onSubmit={submitRequest}><div className="section-heading"><div><h2>Manual material request</h2><p className="muted">For unexpected needs outside the regular stock count.</p></div></div><SiteSelect sites={sites} siteId={siteId} setSiteId={setSiteId} /><div className="priority-segment" role="group" aria-label="Request priority">{(['urgent','normal','low'] as const).map((item) => <button type="button" key={item} className={`priority-choice ${item} ${priority === item ? 'active' : ''}`} aria-pressed={priority === item} onClick={() => setPriority(item)}><span aria-hidden="true">{item === 'urgent' ? '!' : item === 'normal' ? '•' : '↓'}</span>{item === 'urgent' ? 'Urgent' : item === 'normal' ? 'Normal' : 'Low'}</button>)}</div><div className="request-material-grid">{catalog.map((item) => <label className={requestQuantities[item.id] ? 'selected' : ''} key={item.id}><span><strong>{item.name}</strong><small>{item.category}</small></span><input type="number" min="0" max="999" value={requestQuantities[item.id] ?? 0} onChange={(event) => setRequestQuantities((current) => ({ ...current, [item.id]: Math.max(0, Number(event.target.value) || 0) }))} aria-label={`${item.name} requested quantity`} /></label>)}</div><label>Reason / delivery note<textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label><button type="submit" disabled={saving || !selectedRequestItems.length}>{saving ? 'Creating request…' : `Request ${selectedRequestItems.length || ''} material${selectedRequestItems.length === 1 ? '' : 's'}`}</button></form> : null}

    {!busy && tab === 'history' ? <section className="card"><div className="section-heading"><div><h2>{canManage ? 'Request history' : 'My requests'}</h2><p className="muted">{canManage ? 'Search the full request lifecycle without leaving Supplies.' : 'Track what you asked for and where it is in the process.'}</p></div><span className="section-icon" aria-hidden="true">▤</span></div><ListControls query={requestQuery} onQueryChange={setRequestQuery} from={requestFrom} to={requestTo} onFromChange={setRequestFrom} onToChange={setRequestTo} placeholder="Search site, status or material…" onClear={() => { setRequestQuery(''); setRequestFrom(''); setRequestTo('') }} /><RequestList requests={visibleRequests} canManage={canManage} onAdvance={moveRequest} onRepeat={repeatRequest} onOpen={setSelectedRequest} busyId={busyRequest} /></section> : null}
    <SupplyDetailSheet
      open={Boolean(selectedRequest)}
      active={Boolean(selectedRequest) && !emailRequest && !confirmTransition}
      request={selectedRequest}
      onClose={() => setSelectedRequest(null)}
      onSendEmail={() => { if (selectedRequest) setEmailRequest(selectedRequest) }}
      onTransition={(status) => { if (selectedRequest) setConfirmTransition({ request: selectedRequest, status }) }}
      assignees={assignees}
      onAssign={(email) => selectedRequest ? assignRequest(selectedRequest, email) : Promise.resolve()}
    />
    <EmailModal open={Boolean(emailRequest)} active={Boolean(emailRequest)} request={emailRequest} onClose={() => setEmailRequest(null)} onSend={notifyClient} />
    <ConfirmModal
      open={Boolean(confirmTransition)}
      active={Boolean(confirmTransition)}
      message={confirmTransition ? `Move ${confirmTransition.request.clientLocation} from ${confirmTransition.request.status} to ${confirmTransition.status}?` : ''}
      onClose={() => setConfirmTransition(null)}
      onConfirm={() => {
        if (!confirmTransition) return
        const transition = confirmTransition
        setConfirmTransition(null)
        void moveRequest(transition.request, transition.status).then(() => setSelectedRequest(null))
      }}
    />
  </main>
}

function SiteSelect({ sites, siteId, setSiteId }: { sites: Site[]; siteId: string; setSiteId: (value: string) => void }) {
  return <div className="materials-select-field"><span>Client site</span><StandardSelect searchable={sites.length > 8} value={siteId} onChange={setSiteId} ariaLabel="Client site" placeholder="Select site" searchPlaceholder="Search client or site…" options={sites.map((site) => ({ value: site.id, label: `${site.client.displayName} · ${site.name}` }))} /></div>
}
function RequestList({ requests, canManage, onAdvance, onRepeat, onOpen, busyId }: { requests: Supply[]; canManage: boolean; onAdvance: (request: Supply, status: string) => Promise<void>; onRepeat: (request: Supply) => void; onOpen: (request: Supply) => void; busyId: string | null }) {
  if (!requests.length) return <p className="muted empty-copy">No requests in this view.</p>
  return <div className="materials-list scroll-list">{requests.map((request) => { const overdue = Boolean(request.dueAt && new Date(request.dueAt) < new Date() && !CLOSED.has(request.status)); const next = NEXT_STATUS[request.status]; return <article className={`request-row${overdue ? ' request-overdue' : ''}`} key={request.id}><div className="request-row-top"><span className={`priority-dot ${request.priority}`} /><strong>{request.clientLocation}</strong><span className={`status-chip supply-${request.status.toLowerCase().replaceAll(' ','-')}`}>{request.status}</span></div><p>{request.items.map((item) => `${item.product} × ${item.quantity}`).join(' · ')}</p><small>{canManage ? `Requested by ${request.employeeName} · ` : ''}{request.source === 'stock_count' ? 'Auto-detected from count' : 'Manual request'} · {new Date(request.createdAt).toLocaleString('en-IE')}{request.assignedTo ? ` · owner ${request.assignedTo}` : ''}{overdue ? ' · OVERDUE' : ''}</small><div className="request-actions"><button type="button" className="btn-secondary compact" onClick={() => onOpen(request)}>Open request</button>{canManage && next ? <button type="button" className="btn-primary compact" disabled={busyId === request.id} onClick={() => void onAdvance(request, next)}>{busyId === request.id ? 'Updating…' : `Mark ${next}`}</button> : null}{!CLOSED.has(request.status) && request.status === 'Requested' ? <button type="button" className="btn-ghost danger compact" disabled={busyId === request.id} onClick={() => void onAdvance(request, 'Cancelled')}>Cancel</button> : null}<button type="button" className="btn-secondary compact" onClick={() => onRepeat(request)}>Repeat request</button></div>{request.history?.length ? <details className="request-history"><summary>History ({request.history.length})</summary>{request.history.map((event) => <div key={event.id}><b>{event.toStatus}</b><span>{new Date(event.createdAt).toLocaleString('en-IE')} · {event.actorEmail}</span>{event.note ? <small>{event.note}</small> : null}</div>)}</details> : null}</article> })}</div>
}
