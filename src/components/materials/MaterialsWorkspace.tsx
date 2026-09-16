'use client'

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupplyPriority, SupplyRequest, SupplyStatus } from '../../types'
import { clientApi } from '../../lib/client-api'
import ListControls from '../ui/ListControls'
import PaginationControls from '../ui/PaginationControls'
import StandardSelect from '../ui/StandardSelect'
import SupplyOperationsOverview from './SupplyOperationsOverview'
import { SupplyDetailSheet } from '../dashboard/SupplyDetailSheet'
import { EmailModal } from '../dashboard/EmailModal'
import { ConfirmModal } from '../dashboard/ConfirmModal'
import OpsIcon from '../ui/OpsIcon'
import styles from './MaterialsWorkspace.module.css'

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
type StockRiskLevel = Control['levels'][number]
type RiskLocation = { site: Site; levels: StockRiskLevel[]; out: number; reorder: number; low: number }
type SuppliesBootstrap = { sites: Site[]; catalog: Material[]; requests: Supply[]; control: Control | null; assignees: Assignee[] }
type SupplyPage = { total: number; page: number; limit: number; totalPages: number; items: Supply[] }
type RepeatDraft = {
  location?: string
  priority?: 'urgent' | 'normal' | 'low'
  notes?: string
  items?: Array<{ catalogItemId?: string | null; product: string; quantity: number }>
  selected?: string[]
  quantities?: Record<string, number>
}

const NEXT_STATUS: Record<string, string | undefined> = { Requested: 'Triaged', Triaged: 'Approved', Approved: 'Ordered', Ordered: 'In transit', 'In transit': 'Delivered' }
const CLOSED = new Set(['Delivered', 'Rejected', 'Cancelled'])
const HISTORY_LIMIT = 12
const QUEUE_LIMIT = 10
const HISTORY_STATUSES: SupplyStatus[] = ['Requested', 'Triaged', 'Approved', 'Ordered', 'In transit', 'Delivered', 'Rejected', 'Cancelled']
function displaySupplyStatus(status: string) { return status === 'InTransit' ? 'In transit' : status }
function statusQueryValue(status: SupplyStatus) { return status === 'In transit' ? 'in-transit' : status.toLowerCase() }
const api = clientApi

export default function MaterialsWorkspace({ canManage, personalView = false }: { canManage: boolean; personalView?: boolean }) {
  const [tab, setTab] = useState<Tab>(personalView ? 'history' : canManage ? 'overview' : 'count')
  const [sites, setSites] = useState<Site[]>([]); const [catalog, setCatalog] = useState<Material[]>([]); const [stock, setStock] = useState<Material[]>([]); const [requests, setRequests] = useState<Supply[]>([]); const [control, setControl] = useState<Control | null>(null)
  const [siteId, setSiteId] = useState(''); const [quantities, setQuantities] = useState<Record<string, string>>({}); const [requestQuantities, setRequestQuantities] = useState<Record<string, number>>({}); const [priority, setPriority] = useState<'urgent' | 'normal' | 'low'>('normal'); const [note, setNote] = useState('')
  const [busy, setBusy] = useState(true); const [saving, setSaving] = useState(false); const [busyRequest, setBusyRequest] = useState<string | null>(null); const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [requestQuery, setRequestQuery] = useState(''); const [requestFrom, setRequestFrom] = useState(''); const [requestTo, setRequestTo] = useState('')
  const [supplyFilter, setSupplyFilter] = useState<SupplyFilter>({})
  const [riskLocationQuery, setRiskLocationQuery] = useState('')
  const [queuePage, setQueuePage] = useState(1)
  const [queueData, setQueueData] = useState<SupplyPage>({ total: 0, page: 1, limit: QUEUE_LIMIT, totalPages: 1, items: [] })
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueRevision, setQueueRevision] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyStatus, setHistoryStatus] = useState<'all' | SupplyStatus>('all')
  const [historyPriority, setHistoryPriority] = useState<'all' | SupplyPriority>('all')
  const [historyScope, setHistoryScope] = useState<'all' | 'mine'>(personalView || !canManage ? 'mine' : 'all')
  const [historyData, setHistoryData] = useState<SupplyPage>({ total: 0, page: 1, limit: HISTORY_LIMIT, totalPages: 1, items: [] })
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyRevision, setHistoryRevision] = useState(0)
  const [selectedRequest, setSelectedRequest] = useState<Supply | null>(null)
  const [emailRequest, setEmailRequest] = useState<Supply | null>(null)
  const [confirmTransition, setConfirmTransition] = useState<{ request: Supply; status: SupplyStatus } | null>(null)
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const repeatDraftChecked = useRef(false)
  const queueViewportRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setBusy(true)
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
            const selectedItems = draft.items?.length
              ? draft.items
              : (draft.selected ?? []).map((product) => ({ catalogItemId: null, product, quantity: draft.quantities?.[product] ?? 1 }))
            const nextQuantities: Record<string, number> = {}
            let completeMaterialMatch = selectedItems.length > 0
            for (const selectedItem of selectedItems) {
              const material = selectedItem.catalogItemId
                ? bootstrap.catalog.find((item) => item.id === selectedItem.catalogItemId)
                : bootstrap.catalog.find((item) => item.name.trim().toLowerCase() === selectedItem.product.trim().toLowerCase())
              const quantity = Math.max(0, Number(selectedItem.quantity) || 0)
              if (!material || quantity <= 0) {
                completeMaterialMatch = false
                continue
              }
              nextQuantities[material.id] = quantity
            }

            if (repeatedSite && completeMaterialMatch && Object.keys(nextQuantities).length === selectedItems.length) {
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
      setHistoryRevision((value) => value + 1)
      setQueueRevision((value) => value + 1)
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load materials.' }) }
    finally { if (!options?.silent) setBusy(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (!siteId || tab !== 'count') return; void api<Material[]>(`/api/sites/${siteId}/stock`).then((data) => { setStock(data); setQuantities(Object.fromEntries(data.map((item) => [item.id, String(item.onHand ?? 0)]))) }).catch((error) => setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load site stock.' })) }, [siteId, tab])

  const loadQueue = useCallback(async () => {
    if (tab !== 'overview' || !canManage) return
    setQueueLoading(true)
    try {
      const params = new URLSearchParams({ page: String(queuePage), limit: String(QUEUE_LIMIT) })
      if (requestQuery.trim()) params.set('search', requestQuery.trim())
      if (requestFrom) params.set('from', requestFrom)
      if (requestTo) params.set('to', requestTo)
      if (supplyFilter.status) params.set('status', statusQueryValue(supplyFilter.status))
      if (supplyFilter.priority) params.set('priority', supplyFilter.priority)
      if (supplyFilter.preset && supplyFilter.preset !== 'all') params.set('preset', supplyFilter.preset)
      const data = await api<SupplyPage>(`/api/supplies?${params.toString()}`)
      setQueueData({
        ...data,
        items: data.items.map((item) => ({ ...item, status: displaySupplyStatus(item.status) as SupplyStatus })),
      })
      if (queuePage > data.totalPages) setQueuePage(data.totalPages)
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load the request queue.' })
    } finally {
      setQueueLoading(false)
    }
  }, [canManage, queuePage, requestFrom, requestQuery, requestTo, supplyFilter, tab])
  useEffect(() => {
    if (tab !== 'overview' || !canManage) return
    const timer = window.setTimeout(() => void loadQueue(), 160)
    return () => window.clearTimeout(timer)
  }, [loadQueue, queueRevision, tab, canManage])
  useEffect(() => {
    setQueuePage(1)
    queueViewportRef.current?.scrollTo({ top: 0 })
  }, [requestFrom, requestQuery, requestTo, supplyFilter])

  const loadHistory = useCallback(async () => {
    if (tab !== 'history') return
    setHistoryLoading(true)
    try {
      const params = new URLSearchParams({ page: String(historyPage), limit: String(HISTORY_LIMIT) })
      if (requestQuery.trim()) params.set('search', requestQuery.trim())
      if (requestFrom) params.set('from', requestFrom)
      if (requestTo) params.set('to', requestTo)
      if (historyStatus !== 'all') params.set('status', statusQueryValue(historyStatus))
      if (historyPriority !== 'all') params.set('priority', historyPriority)
      if (!canManage || personalView || historyScope === 'mine') params.set('mine', 'true')
      const data = await api<SupplyPage>(`/api/supplies?${params.toString()}`)
      setHistoryData({
        ...data,
        items: data.items.map((item) => ({ ...item, status: displaySupplyStatus(item.status) as SupplyStatus })),
      })
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load supply requests.' })
    } finally {
      setHistoryLoading(false)
    }
  }, [canManage, historyPage, historyPriority, historyScope, historyStatus, personalView, requestFrom, requestQuery, requestTo, tab])
  useEffect(() => {
    if (tab !== 'history') return
    const timer = window.setTimeout(() => void loadHistory(), 160)
    return () => window.clearTimeout(timer)
  }, [historyRevision, loadHistory, tab])
  useEffect(() => { setHistoryPage(1) }, [historyPriority, historyScope, historyStatus, requestFrom, requestQuery, requestTo])

  const groupedStock = useMemo(() => Object.entries(stock.reduce<Record<string, Material[]>>((groups, item) => { (groups[item.category] ??= []).push(item); return groups }, {})), [stock])
  const selectedRequestItems = Object.entries(requestQuantities).filter(([, quantity]) => quantity > 0)
  const selectedRequestUnits = selectedRequestItems.reduce((total, [, quantity]) => total + quantity, 0)
  const riskLocations = useMemo(() => {
    if (!control) return []
    const severity = { out: 0, reorder: 1, low: 2, healthy: 3 } as const
    const groups = new Map<string, RiskLocation>()
    for (const level of control.levels) {
      if (level.state === 'healthy') continue
      const group = groups.get(level.site.id) ?? { site: level.site, levels: [], out: 0, reorder: 0, low: 0 }
      group.levels.push(level)
      if (level.state === 'out') group.out += 1
      else if (level.state === 'reorder') group.reorder += 1
      else group.low += 1
      groups.set(level.site.id, group)
    }
    const needle = riskLocationQuery.trim().toLowerCase()
    return Array.from(groups.values())
      .filter((group) => !needle || `${group.site.client.displayName} ${group.site.name}`.toLowerCase().includes(needle))
      .map((group) => ({
        ...group,
        levels: group.levels.sort((a, b) => severity[a.state ?? 'healthy'] - severity[b.state ?? 'healthy'] || (a.onHand ?? 0) - (b.onHand ?? 0)),
      }))
      .sort((a, b) => b.out - a.out || b.reorder - a.reorder || b.low - a.low || a.site.name.localeCompare(b.site.name))
  }, [control, riskLocationQuery])

  async function submitCount(event: FormEvent) {
    event.preventDefault(); if (!siteId || !stock.length) return; setSaving(true)
    try {
      await api(`/api/sites/${siteId}/stock-counts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'cycle_count', note: note || undefined, lines: stock.map((item) => ({ catalogItemId: item.id, quantity: Math.max(0, Number(quantities[item.id]) || 0) })) }) })
      setMessage({ kind: 'success', text: 'Count saved. Stock levels were updated for Operations review.' }); setNote(''); await refresh(); setTab(canManage ? 'overview' : 'history')
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
    try { await api(`/api/supplies/${request.id}/status`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, note: status === 'Cancelled' ? 'Cancelled from materials control.' : `Moved to ${status} from materials control.` }) }); setMessage({ kind: 'success', text: `${request.clientLocation}: ${status}.` }); await refresh({ silent: true }) }
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
      setQueueData((current) => ({ ...current, items: current.items.map((item) => item.id === result.id ? { ...item, assignedTo: result.assignedTo ?? undefined } : item) }))
      setHistoryData((current) => ({ ...current, items: current.items.map((item) => item.id === result.id ? { ...item, assignedTo: result.assignedTo ?? undefined } : item) }))
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
      await refresh({ silent: true })
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Could not queue client email.' })
    } finally {
      setBusyRequest(null)
    }
  }

  function repeatRequest(request: Supply) {
    const next: Record<string, number> = {}
    for (const item of request.items) { const catalogId = item.catalogItemId ?? catalog.find((candidate) => candidate.name === item.product)?.id; if (catalogId) next[catalogId] = item.quantity }
    setRequestQuantities(next); setPriority(request.priority); setNote(request.notes ?? ''); if (request.siteId && sites.some((site) => site.id === request.siteId)) setSiteId(request.siteId); setTab('request'); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return <main className="page-shell materials-shell">
    <header className="page-header materials-header"><div><span className="eyebrow">{personalView ? 'Personal supply workspace' : 'Requests, procurement & stock'}</span><h1>{personalView ? 'My requests' : 'Supplies'}</h1><p className="muted">{personalView ? 'Create a request, follow its next step and reuse previous orders without switching modules.' : 'Process requests from the field, keep stock reality current and see shortages before they disrupt service.'}</p></div><button type="button" className="secondary-button" onClick={() => void refresh()} disabled={busy}><OpsIcon name="refresh" size={16} /> Refresh</button></header>
    {message ? <div className={`transient-notice ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}><span>{message.text}</span><button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message">×</button></div> : null}
    <nav className="materials-tabs" aria-label={personalView ? 'My supply request views' : 'Supplies views'}>
      {personalView ? <>
        <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>My requests</button>
        <button type="button" className={tab === 'request' ? 'active' : ''} onClick={() => setTab('request')}>New request</button>
        <button type="button" className={tab === 'count' ? 'active' : ''} onClick={() => setTab('count')}>Stock count</button>
      </> : <>
        {canManage ? <button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Requests & stock</button> : null}
        <button type="button" className={tab === 'count' ? 'active' : ''} onClick={() => setTab('count')}>Count stock</button>
        <button type="button" className={tab === 'request' ? 'active' : ''} onClick={() => setTab('request')}>New request</button>
        <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>{canManage ? 'Request history' : 'My requests'}</button>
      </>}
    </nav>
    {busy ? <section className="card empty-state">Loading material intelligence…</section> : null}

    {!busy && tab === 'overview' && control ? <><SupplyOperationsOverview requests={requests} filter={supplyFilter} onFilter={(filter) => { setSupplyFilter(filter); setRequestQuery(''); setRequestFrom(''); setRequestTo('') }} /><section className="materials-summary" aria-label="Stock health summary">{[['Out of stock', control.summary.outOfStock, 'Action now'], ['Reorder', control.summary.needsReorder, 'At or below threshold'], ['Open requests', control.summary.openRequests, `${control.summary.overdueRequests} overdue`], ['Uncounted sites', control.summary.sitesWithoutCount, 'No baseline yet']].map(([label, value, detail]) => <article className="metric-card" key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>)}</section><section className={`materials-grid ${styles.overviewGrid}`}><article className={`card ${styles.riskCard}`} data-testid="stock-risk-card">
  <div className="section-heading"><div><h2>Stock risk by location</h2><p className="muted">Start with the site that needs attention, then expand only the materials you need to review.</p></div><span className="section-icon" aria-hidden="true"><OpsIcon name="alert" size={18} /></span></div>
  <div className={styles.riskExplanation}><span className={styles.riskIcon}><OpsIcon name="activity" size={16} /></span><span><strong>Risk levels</strong><br />Out = no stock. Reorder = at or below reorder point. Low = below par.</span></div>
  <label className={styles.riskSearch}><OpsIcon name="search" size={16} /><span className="sr-only">Search risk locations</span><input type="search" value={riskLocationQuery} onChange={(event) => setRiskLocationQuery(event.target.value)} placeholder="Search client or site…" /></label>
  <div className={styles.riskLocationMeta}><strong>{riskLocations.length}</strong><span>location{riskLocations.length === 1 ? '' : 's'} needing attention</span></div>
  <div className={styles.riskLocationList}>
    {riskLocations.map((group) => <details className={styles.riskLocationCard} key={group.site.id}>
      <summary className={styles.riskLocationSummary}>
        <span className={styles.riskLocationPin}><OpsIcon name="pin" size={17} /></span>
        <span className={styles.riskLocationTitle}><strong>{group.site.name}</strong><small>{group.site.client.displayName}</small></span>
        <span className={styles.riskSignals}>
          {group.out ? <span className={styles.signalOut}>{group.out} out</span> : null}
          {group.reorder ? <span className={styles.signalReorder}>{group.reorder} reorder</span> : null}
          {group.low ? <span className={styles.signalLow}>{group.low} low</span> : null}
        </span>
        <span className={styles.riskLocationCount}>{group.levels.length} item{group.levels.length === 1 ? '' : 's'}</span>
        <span className={styles.riskChevron}><OpsIcon name="chevronRight" size={16} /></span>
      </summary>
      <div className={styles.riskLocationItems}>
        {group.levels.map((level) => <div className={styles.riskRow} key={level.id}>
          <span className={`${styles.riskState} ${styles[level.state ?? 'low']}`}>{riskStateLabel(level.state)}</span>
          <div className={styles.riskMain}><strong>{level.catalogItem?.name ?? level.name}</strong><small>{level.daysRemaining != null ? `~${level.daysRemaining} days remaining · ` : ''}reorder {level.reorderPoint ?? level.defaultReorderPoint} · par {level.parLevel ?? level.defaultParLevel}</small></div>
          <div className={styles.riskNumbers}><strong>{level.onHand ?? 0}</strong><small>on hand</small></div>
        </div>)}
      </div>
    </details>)}
    {!riskLocations.length ? <div className={styles.riskEmpty}><OpsIcon name={riskLocationQuery ? 'search' : 'check'} size={18} /><strong>{riskLocationQuery ? 'No matching locations' : 'No stock risk detected'}</strong><span>{riskLocationQuery ? 'Try a different client or site name.' : 'All counted items are at or above par.'}</span></div> : null}
  </div>
</article><article className={`card ${styles.queueCard}`} data-testid="request-queue-card">
  <div className={`section-heading ${styles.queueHeading}`}>
    <div><h2>Request queue</h2><p className="muted">Triage the matching requests without turning the whole dashboard into one long list.</p></div>
    <div className={styles.queueHeadingMeta}><span className={styles.queueCount}>{queueData.total}</span><span className="section-icon violet" aria-hidden="true"><OpsIcon name="review" size={17} /></span></div>
  </div>
  <ListControls query={requestQuery} onQueryChange={setRequestQuery} from={requestFrom} to={requestTo} onFromChange={setRequestFrom} onToChange={setRequestTo} placeholder="Search site or material…" onClear={() => { setRequestQuery(''); setRequestFrom(''); setRequestTo('') }} />
  <div ref={queueViewportRef} className={styles.queueViewport} aria-label="Supply request queue" data-testid="request-queue-viewport">
    {queueLoading && !queueData.items.length ? <div className={styles.queueLoading} role="status"><OpsIcon name="refresh" size={17} />Loading requests…</div> : <RequestList requests={queueData.items} canManage={canManage} onAdvance={moveRequest} onCancel={(request) => setConfirmTransition({ request, status: 'Cancelled' })} onRepeat={repeatRequest} onOpen={setSelectedRequest} busyId={busyRequest} />}
  </div>
  <PaginationControls page={queueData.page} totalPages={queueData.totalPages} total={queueData.total} limit={queueData.limit || QUEUE_LIMIT} loading={queueLoading} noun="requests" onPageChange={(page) => { setQueuePage(page); queueViewportRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) }} className={styles.queuePagination} />
</article></section></> : null}

    {!busy && tab === 'count' ? <form className={`card materials-form ${styles.formShell}`} onSubmit={submitCount}>
      <div className={styles.formHero}>
        <div className={styles.heroTitle}><span className={styles.heroIcon}><OpsIcon name="layers" size={23} /></span><div><h2>Fast site count</h2><p>Record what is physically on site. This updates stock visibility for Operations.</p></div></div>
        <div className={styles.heroHint}><OpsIcon name="check" size={17} /><div><strong>Count only</strong><span>Saving a count does not create a supply request. Operations can review stock risk separately.</span></div></div>
      </div>
      <div className={styles.formBody}>
        <div className={styles.siteAndHelp}>
          <div className={styles.sitePanel}><SiteSelect sites={sites} siteId={siteId} setSiteId={setSiteId} /></div>
          <div className={styles.helpPanel}><OpsIcon name="review" size={18} /><div><strong>Keep it simple</strong><span>Enter the physical quantity you can see. You do not need to decide whether anything should be ordered.</span></div></div>
        </div>
        <div className={styles.categoryStack}>{groupedStock.map(([category, items]) => {
          const meta = categoryMeta(category)
          return <section className={styles.categoryCard} key={category}>
            <header className={styles.categoryHeader}><div className={styles.categoryTitle}><span className={`${styles.categoryIcon} ${meta.className ? styles[meta.className] : ''}`}><OpsIcon name={meta.icon} size={19} /></span><div><strong>{category}</strong><small>{meta.description}</small></div></div><span className={styles.itemCount}>{items.length} item{items.length === 1 ? '' : 's'}</span></header>
            <div className={styles.materialRows}>{items.map((item) => <div className={styles.materialRow} key={item.id}><MaterialIcon item={item} /><div className={styles.materialCopy}><strong>{item.name}</strong><small>{item.sku} · par {item.parLevel ?? item.defaultParLevel} · reorder {item.reorderPoint ?? item.defaultReorderPoint}</small></div><QuantityStepper value={quantities[item.id] ?? '0'} onChange={(value) => setQuantities((current) => ({ ...current, [item.id]: value }))} ariaLabel={`${item.name} on hand`} /></div>)}</div>
          </section>
        })}</div>
        {!sites.length ? <p className="muted">Create a client site before counting stock.</p> : null}
        <div className={styles.helperStrip}><OpsIcon name="check" size={16} />Count what is present now. Stock risk and ordering decisions stay with Operations.</div>
        <label className={styles.noteField}><span className={styles.noteLabel}><span className={styles.noteIcon}><OpsIcon name="note" size={16} /></span><span><strong>Count note</strong><small>Optional context for deliveries, damage or inaccessible stock.</small></span></span><textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Delivery received, damaged stock, locked cupboard…" /></label>
        <div className={styles.stickyActions}><div className={styles.actionSummary}><span><OpsIcon name="layers" size={17} /></span><div><strong>{stock.length} tracked item{stock.length === 1 ? '' : 's'}</strong><small>Count only · no supply request will be created</small></div></div><div className={styles.actionButtons}><button type="submit" className="btn-primary" disabled={saving || !stock.length}>{saving ? 'Saving count…' : 'Save count'}</button></div></div>
      </div>
    </form> : null}

    {!busy && tab === 'request' ? <form className={`card materials-form ${styles.formShell}`} onSubmit={submitRequest}>
      <div className={styles.formHero}>
        <div className={styles.heroTitle}><span className={styles.heroIcon}><OpsIcon name="box" size={23} /></span><div><h2>Manual material request</h2><p>For unexpected needs outside the regular stock count.</p></div></div>
        <div className={styles.heroHint}><OpsIcon name="incident" size={17} /><div><strong>Need supplies urgently?</strong><span>Choose Urgent only when waiting could disrupt service. Operations will see the priority immediately.</span></div></div>
      </div>
      <div className={styles.formBody}>
        <div className={styles.sitePanel}><SiteSelect sites={sites} siteId={siteId} setSiteId={setSiteId} /></div>
        <div><div className="section-heading"><div><h3>Request priority</h3><p className="muted">Set how quickly this request needs attention.</p></div></div><div className={styles.priorityGrid} role="group" aria-label="Request priority">{(['urgent','normal','low'] as const).map((item) => {
          const copy = item === 'urgent' ? 'Immediate need' : item === 'normal' ? 'Standard request' : 'Can wait'
          const icon = item === 'urgent' ? 'incident' : item === 'normal' ? 'clock' : 'trend'
          return <button type="button" key={item} className={`${styles.priorityCard} ${styles[item]} ${priority === item ? styles.active : ''}`} aria-label={item[0].toUpperCase() + item.slice(1)} aria-pressed={priority === item} onClick={() => setPriority(item)}><span><OpsIcon name={icon} size={16} /></span><span><strong>{item[0].toUpperCase() + item.slice(1)}</strong><small>{copy}</small></span></button>
        })}</div></div>
        <div><div className="section-heading"><div><h3>Items requested</h3><p className="muted">Adjust quantities for only the materials you need.</p></div></div><div className={styles.requestGrid}>{catalog.map((item) => <div className={`${styles.requestMaterial} ${requestQuantities[item.id] ? styles.selected : ''}`} key={item.id}><MaterialIcon item={item} /><div className={styles.materialCopy}><strong>{item.name}</strong><small>{item.category}</small></div><QuantityStepper value={String(requestQuantities[item.id] ?? 0)} onChange={(value) => setRequestQuantities((current) => ({ ...current, [item.id]: Math.max(0, Number(value) || 0) }))} ariaLabel={`${item.name} requested quantity`} dataCatalogId={item.id} /></div>)}</div></div>
        <label className={styles.noteField}><span className={styles.noteLabel}><span className={styles.noteIcon}><OpsIcon name="note" size={16} /></span><span><strong>Reason / delivery note</strong><small>Tell operations why you need these items and add any delivery notes (optional).</small></span></span><textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Add a note…" /></label>
        <div className={styles.stickyActions}><div className={styles.actionSummary}><span><OpsIcon name="box" size={17} /></span><div><strong>{selectedRequestItems.length} item{selectedRequestItems.length === 1 ? '' : 's'} selected</strong><small>{selectedRequestUnits} total unit{selectedRequestUnits === 1 ? '' : 's'}</small></div></div><div className={styles.actionButtons}><button type="button" className="btn-secondary" onClick={() => { setRequestQuantities({}); setNote('') }} disabled={saving}>Clear</button><button type="submit" className="btn-primary" disabled={saving || !selectedRequestItems.length}>{saving ? 'Creating request…' : 'Submit request'}</button></div></div>
      </div>
    </form> : null}

    {!busy && tab === 'history' ? <section className="card supply-history-card">
      <div className="section-heading"><div><h2>{personalView || !canManage ? 'My requests' : 'Request history'}</h2><p className="muted">{personalView || !canManage ? 'Track each request by next action instead of scanning a long status timeline.' : 'Search the full lifecycle, or switch to Requested by me without leaving Supplies.'}</p></div><div className="history-result-count"><strong>{historyData.total}</strong><span>matching request{historyData.total === 1 ? '' : 's'}</span></div></div>
      <div className="supply-history-toolbar">
        {canManage && !personalView ? <div className="supply-scope-toggle" role="group" aria-label="Request ownership">
          <button type="button" className={historyScope === 'all' ? 'active' : ''} aria-pressed={historyScope === 'all'} onClick={() => setHistoryScope('all')}>All requests</button>
          <button type="button" className={historyScope === 'mine' ? 'active' : ''} aria-pressed={historyScope === 'mine'} onClick={() => setHistoryScope('mine')}>Requested by me</button>
        </div> : null}
        <ListControls
          query={requestQuery}
          onQueryChange={setRequestQuery}
          from={requestFrom}
          to={requestTo}
          onFromChange={setRequestFrom}
          onToChange={setRequestTo}
          placeholder="Search site, requester or material…"
          hasActiveFilters={Boolean(requestQuery.trim() || requestFrom || requestTo || historyStatus !== 'all' || historyPriority !== 'all')}
          onClear={() => { setRequestQuery(''); setRequestFrom(''); setRequestTo(''); setHistoryStatus('all'); setHistoryPriority('all') }}
          options={[
            { label: 'Status', value: historyStatus, defaultValue: 'all', choices: [{ value: 'all', label: 'All statuses' }, ...HISTORY_STATUSES.map((status) => ({ value: status, label: status }))], onChange: (value) => setHistoryStatus(value as 'all' | SupplyStatus) },
            { label: 'Priority', value: historyPriority, defaultValue: 'all', choices: [{ value: 'all', label: 'All priorities' }, { value: 'urgent', label: 'Urgent' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' }], onChange: (value) => setHistoryPriority(value as 'all' | SupplyPriority) },
          ]}
        />
      </div>
      {historyLoading && !historyData.items.length ? <div className="supply-list-loading" role="status">Loading requests…</div> : <RequestList requests={historyData.items} canManage={canManage && !personalView} onAdvance={moveRequest} onCancel={(request) => setConfirmTransition({ request, status: 'Cancelled' })} onRepeat={repeatRequest} onOpen={setSelectedRequest} busyId={busyRequest} />}
      <PaginationControls page={historyPage} totalPages={historyData.totalPages} total={historyData.total} limit={historyData.limit || HISTORY_LIMIT} loading={historyLoading} noun="requests" onPageChange={setHistoryPage} />
    </section> : null}
    <SupplyDetailSheet
      open={Boolean(selectedRequest)}
      active={Boolean(selectedRequest) && !emailRequest && !confirmTransition}
      request={selectedRequest}
      onClose={() => setSelectedRequest(null)}
      onSendEmail={() => { if (selectedRequest) setEmailRequest(selectedRequest) }}
      onTransition={(status) => { if (selectedRequest) setConfirmTransition({ request: selectedRequest, status }) }}
      assignees={assignees}
      onAssign={(email) => selectedRequest ? assignRequest(selectedRequest, email) : Promise.resolve()}
      canManageActions={canManage && !personalView}
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


function categoryMeta(category: string): { icon: 'flask' | 'layers' | 'shield'; description: string; className?: 'consumables' | 'ppe' } {
  const normalized = category.toLowerCase()
  if (normalized.includes('consum')) return { icon: 'layers', description: 'Everyday consumable items', className: 'consumables' }
  if (normalized.includes('ppe') || normalized.includes('tool')) return { icon: 'shield', description: 'Personal protection and cleaning tools', className: 'ppe' }
  return { icon: 'flask', description: 'Cleaning and disinfecting products' }
}

function materialIconName(category: string): 'flask' | 'layers' | 'shield' {
  return categoryMeta(category).icon
}

function MaterialIcon({ item }: { item: Pick<Material, 'category'> }) {
  return <span className={styles.materialIcon}><OpsIcon name={materialIconName(item.category)} size={17} /></span>
}

function QuantityStepper({ value, onChange, ariaLabel, dataCatalogId }: { value: string; onChange: (value: string) => void; ariaLabel: string; dataCatalogId?: string }) {
  const number = Math.max(0, Number(value) || 0)
  return <div className={styles.stepper}>
    <button type="button" aria-label={`Decrease ${ariaLabel.replace(/ requested quantity| on hand/g, '')}`} onClick={() => onChange(String(Math.max(0, number - 1)))}><OpsIcon name="minus" size={15} /></button>
    <input type="number" min="0" max="999" inputMode="numeric" data-catalog-id={dataCatalogId} value={value} onChange={(event) => onChange(event.target.value)} aria-label={ariaLabel} />
    <button type="button" aria-label={`Increase ${ariaLabel.replace(/ requested quantity| on hand/g, '')}`} onClick={() => onChange(String(Math.min(999, number + 1)))}><OpsIcon name="plus" size={15} /></button>
  </div>
}

function riskStateLabel(state?: Material['state']) {
  if (state === 'out') return 'Out of stock'
  if (state === 'reorder') return 'Reorder now'
  return 'Below par'
}

function SiteSelect({ sites, siteId, setSiteId }: { sites: Site[]; siteId: string; setSiteId: (value: string) => void }) {
  return <div className="materials-select-field"><span>Client site</span><StandardSelect searchable={sites.length > 8} value={siteId} onChange={setSiteId} ariaLabel="Client site" placeholder="Select site" searchPlaceholder="Search client or site…" options={sites.map((site) => ({ value: site.id, label: `${site.client.displayName} · ${site.name}` }))} /></div>
}
function requestNextAction(request: Supply, canManage: boolean) {
  if (request.status === 'Delivered') return 'Completed'
  if (request.status === 'Rejected') return 'Rejected'
  if (request.status === 'Cancelled') return 'Cancelled'
  if (canManage) return NEXT_STATUS[request.status] ? `Next: ${NEXT_STATUS[request.status]}` : 'Review request'
  return ({
    Requested: 'Awaiting triage',
    Triaged: 'Awaiting approval',
    Approved: 'Approved · awaiting order',
    Ordered: 'Order placed',
    'In transit': 'Delivery in progress',
  } as Partial<Record<SupplyStatus, string>>)[request.status] ?? 'In progress'
}

function RequestList({ requests, canManage, onAdvance, onCancel, onRepeat, onOpen, busyId }: { requests: Supply[]; canManage: boolean; onAdvance: (request: Supply, status: string) => Promise<void>; onCancel: (request: Supply) => void; onRepeat: (request: Supply) => void; onOpen: (request: Supply) => void; busyId: string | null }) {
  if (!requests.length) return <p className="muted empty-copy">No requests match this view.</p>
  return <div className="materials-list request-list-dense">{requests.map((request) => {
    const overdue = Boolean(request.dueAt && new Date(request.dueAt) < new Date() && !CLOSED.has(request.status))
    const next = NEXT_STATUS[request.status]
    const visibleItems = request.items.slice(0, 3)
    const hiddenItemCount = Math.max(0, request.items.length - visibleItems.length)
    return <article className={`request-row request-row-compact${overdue ? ' request-overdue' : ''}`} key={request.id}>
      <div className="request-row-top"><span className={`priority-dot ${request.priority}`} /><strong>{request.clientLocation}</strong><span className={`status-chip supply-${request.status.toLowerCase().replaceAll(' ','-')}`}>{request.status}</span></div>
      <p className="request-row-items">{visibleItems.map((item) => `${item.product} × ${item.quantity}`).join(' · ')}{hiddenItemCount ? ` · +${hiddenItemCount} more` : ''}</p>
      <div className="request-row-context"><small>{canManage ? `Requested by ${request.employeeName} · ` : ''}{request.source === 'stock_count' ? 'From stock count' : 'Manual request'} · {new Date(request.createdAt).toLocaleString('en-IE')}{request.assignedTo ? ` · owner ${request.assignedTo}` : ''}</small><span className={`request-next-action${overdue ? ' overdue' : ''}`}>{overdue ? 'Overdue · ' : ''}{requestNextAction(request, canManage)}</span></div>
      <div className="request-actions request-actions-compact"><button type="button" className="btn-secondary compact" onClick={() => onOpen(request)}>Open</button>{canManage && next ? <button type="button" className="btn-primary compact" disabled={busyId === request.id} onClick={() => void onAdvance(request, next)}>{busyId === request.id ? 'Updating…' : `Mark ${next}`}</button> : null}{request.status === 'Requested' ? <button type="button" className="btn-ghost danger compact" disabled={busyId === request.id} onClick={() => onCancel(request)}>Cancel</button> : null}<button type="button" className="btn-secondary compact" onClick={() => onRepeat(request)}>Repeat</button></div>
    </article>
  })}</div>
}
