'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

type Client = { id: string; displayName: string; legalName?: string | null; status: string; contacts: Array<{ name: string; email?: string | null }>; _count: { sites: number; contracts: number } }
type Site = { id: string; clientId: string; name: string; addressLine1: string; city: string; postalCode: string; geofenceVerifiedM: number; geofenceNearM: number; geofenceSuspiciousM: number; version: number; client: { displayName: string }; access?: { entryInstructions?: string | null }; preferredAssignees?: Array<{ user: TeamMember }>; _count: { areas: number; servicePlans: number } }
type TeamMember = { id: string; name: string | null; email: string; role: string }
type Area = { id: string; name: string; type: string; code?: string | null; active: boolean; children?: Area[] }
type SiteDetail = Site & { areas: Area[]; preferredAssignees: Array<{ user: TeamMember }> }
type Contract = { id: string; clientId: string; name: string; reference?: string | null; status: string; startDate?: string | null; endDate?: string | null; currency: string; client: { id: string; displayName: string }; sites: Array<{ site: { id: string; name: string; city: string } }> }
type Plan = { id: string; name: string; status: string; expectedDurationMinutes: number; requiredWorkers: number; version: number; site: { id: string; name: string; client: { displayName: string } }; _count: { tasks: number; versions: number } }
type Tab = 'clients' | 'contracts' | 'sites' | 'plans'

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Request failed')
  return body.data as T
}

export default function OperationsHub({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<Tab>('clients')
  const [clients, setClients] = useState<Client[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [clientDraft, setClientDraft] = useState({ displayName: '', legalName: '', contactName: '', contactEmail: '' })
  const [contractDraft, setContractDraft] = useState({ clientId: '', name: '', reference: '', startDate: '', endDate: '', siteIds: [] as string[] })
  const [siteDraft, setSiteDraft] = useState({ clientId: '', name: '', addressLine1: '', city: 'Dublin', postalCode: '', entryInstructions: '', preferredAssigneeIds: [] as string[] })
  const [team, setTeam] = useState<TeamMember[]>([])
  const [selectedSite, setSelectedSite] = useState<SiteDetail | null>(null)
  const [areaDraft, setAreaDraft] = useState({ name: '', type: 'room', code: '' })
  const [planDraft, setPlanDraft] = useState({ siteId: '', name: '', expectedDurationMinutes: 120, requiredWorkers: 1, tasks: 'Vacuum floors\nClean bathrooms\nRemove waste' })

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [clientRows, contractRows, siteRows, planRows, teamRows] = await Promise.all([
        api<Client[]>('/api/clients'), api<Contract[]>('/api/contracts'), api<Site[]>('/api/sites'), api<Plan[]>('/api/service-plans'), api<TeamMember[]>('/api/team'),
      ])
      setClients(clientRows); setContracts(contractRows); setSites(siteRows); setPlans(planRows); setTeam(teamRows)
      setSiteDraft((current) => ({ ...current, clientId: current.clientId || clientRows[0]?.id || '' }))
      setContractDraft((current) => ({ ...current, clientId: current.clientId || clientRows[0]?.id || '' }))
      setPlanDraft((current) => ({ ...current, siteId: current.siteId || siteRows[0]?.id || '' }))
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load operations.' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function submitClient(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      await api('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        displayName: clientDraft.displayName, legalName: clientDraft.legalName || null,
        contacts: clientDraft.contactName ? [{ name: clientDraft.contactName, email: clientDraft.contactEmail || null, isPrimary: true }] : [],
      }) })
      setClientDraft({ displayName: '', legalName: '', contactName: '', contactEmail: '' })
      setNotice({ kind: 'success', text: 'Client created and ready for site setup.' }); await refresh()
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not create client.' }) }
    finally { setBusy(false) }
  }

  async function submitSite(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      await api('/api/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        ...siteDraft, countryCode: 'IE', timezone: 'Europe/Dublin', geofenceVerifiedM: 150, geofenceNearM: 250,
        geofenceSuspiciousM: 700, access: { entryInstructions: siteDraft.entryInstructions },
        areas: [{ name: 'Main area', type: 'zone', sortOrder: 0 }],
      }) })
      setSiteDraft((current) => ({ ...current, name: '', addressLine1: '', postalCode: '', entryInstructions: '' }))
      setNotice({ kind: 'success', text: 'Site created with smart distance bands and access record.' }); await refresh()
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not create site.' }) }
    finally { setBusy(false) }
  }

  async function submitContract(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      await api('/api/contracts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        clientId: contractDraft.clientId, name: contractDraft.name, reference: contractDraft.reference || null,
        status: 'active', startDate: contractDraft.startDate || null, endDate: contractDraft.endDate || null,
        currency: 'EUR', siteIds: contractDraft.siteIds, completionPolicy: { checklistRequired: true, blockOnOpenCriticalIncident: true },
      }) })
      setContractDraft((current) => ({ ...current, name: '', reference: '', startDate: '', endDate: '', siteIds: [] }))
      setNotice({ kind: 'success', text: 'Contract activated with its service locations and completion policy.' }); await refresh()
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not create contract.' }) }
    finally { setBusy(false) }
  }

  async function openSite(id: string) {
    setBusy(true)
    try { setSelectedSite(await api<SiteDetail>(`/api/sites/${id}`)); setAreaDraft({ name: '', type: 'room', code: '' }) }
    catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load site areas.' }) }
    finally { setBusy(false) }
  }

  async function savePreferredTeam() {
    if (!selectedSite) return
    setBusy(true)
    try {
      const preferredAssigneeIds = selectedSite.preferredAssignees.map((item) => item.user.id)
      const updated = await api<SiteDetail>(`/api/sites/${selectedSite.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: selectedSite.version, preferredAssigneeIds }) })
      setSelectedSite(updated)
      setNotice({ kind: 'success', text: 'Preferred cleaning team saved. Dispatch will suggest them for this site.' })
      await refresh()
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not save the preferred team.' }) }
    finally { setBusy(false) }
  }

  async function submitArea(event: FormEvent) {
    event.preventDefault(); if (!selectedSite) return; setBusy(true)
    try {
      await api(`/api/sites/${selectedSite.id}/areas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...areaDraft, code: areaDraft.code || null, sortOrder: selectedSite.areas.length }) })
      setNotice({ kind: 'success', text: 'Operational area added to this location.' }); await refresh(); await openSite(selectedSite.id)
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not create area.' }) }
    finally { setBusy(false) }
  }

  async function submitPlan(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      const tasks = planDraft.tasks.split('\n').map((title) => title.trim()).filter(Boolean).map((title, sortOrder) => ({ title, sortOrder, required: true, responseType: 'done_na_problem' }))
      await api('/api/service-plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...planDraft, tasks }) })
      setPlanDraft((current) => ({ ...current, name: '', tasks: '' }))
      setNotice({ kind: 'success', text: 'Draft plan created. Publish it when operationally approved.' }); await refresh()
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not create plan.' }) }
    finally { setBusy(false) }
  }

  async function publishPlan(id: string) {
    setBusy(true)
    try { await api(`/api/service-plans/${id}/publish`, { method: 'POST' }); setNotice({ kind: 'success', text: 'Immutable service-plan version published.' }); await refresh() }
    catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not publish plan.' }) }
    finally { setBusy(false) }
  }

  const needle = query.trim().toLowerCase()
  const visibleClients = useMemo(() => clients.filter((row) => !needle || `${row.displayName} ${row.legalName ?? ''}`.toLowerCase().includes(needle)), [clients, needle])
  const visibleContracts = useMemo(() => contracts.filter((row) => !needle || `${row.name} ${row.reference ?? ''} ${row.client.displayName}`.toLowerCase().includes(needle)), [contracts, needle])
  const visibleSites = useMemo(() => sites.filter((row) => !needle || `${row.name} ${row.client.displayName} ${row.city}`.toLowerCase().includes(needle)), [sites, needle])
  const visiblePlans = useMemo(() => plans.filter((row) => !needle || `${row.name} ${row.site.name} ${row.site.client.displayName}`.toLowerCase().includes(needle)), [plans, needle])

  return <main className="page-shell operations-page">
    <header className="page-header operations-hero"><div><span className="eyebrow">Cleaning operations core</span><h1>Clients, contracts, sites & service plans</h1><p className="muted">One operational chain from commercial agreement to the exact work executed in every area.</p></div><div className="operations-kpis"><span><strong>{clients.length}</strong> clients</span><span><strong>{contracts.length}</strong> contracts</span><span><strong>{sites.length}</strong> sites</span><span><strong>{plans.length}</strong> plans</span></div></header>
    <section className="operations-toolbar" aria-label="Operations views">
      <div className="segmented-control">{(['clients', 'contracts', 'sites', 'plans'] as Tab[]).map((item) => <button key={item} type="button" className={tab === item ? 'selected' : ''} onClick={() => setTab(item)}>{item === 'clients' ? 'Clients' : item === 'contracts' ? 'Contracts' : item === 'sites' ? 'Sites & areas' : 'Service plans'}</button>)}</div>
      <input type="search" aria-label="Search current view" placeholder="Search this view…" value={query} onChange={(event) => setQuery(event.target.value)} />
    </section>
    {notice ? <div className={`toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}<button type="button" className="notice-close" onClick={() => setNotice(null)}>×</button></div> : null}
    {loading ? <section className="card empty-state" aria-live="polite">Loading the operations chain…</section> : null}

    {!loading && tab === 'clients' ? <div className="operations-split">
      <section className="card"><div className="section-heading"><h2>Client portfolio</h2><span className="count-pill">{visibleClients.length}</span></div><div className="operations-list">{visibleClients.map((client) => <article className="operations-row" key={client.id}><div className="entity-icon">C</div><div><strong>{client.displayName}</strong><div className="muted">{client.legalName || client.contacts[0]?.name || 'Commercial account'}</div></div><div className="entity-stats"><span>{client._count.sites} sites</span><span>{client._count.contracts} contracts</span></div><span className={`status-badge ${client.status === 'active' ? 'Completed' : 'Pending'}`}>{client.status}</span></article>)}{!visibleClients.length ? <div className="empty-state">No clients found.</div> : null}</div></section>
      {canManage ? <form className="operations-form" onSubmit={submitClient}><div><span className="eyebrow">Quick setup</span><h2>New client</h2><p className="muted">Start the operational record; sites and plans come next.</p></div><label>Display name<input required value={clientDraft.displayName} onChange={(e) => setClientDraft({ ...clientDraft, displayName: e.target.value })} /></label><label>Legal name<input value={clientDraft.legalName} onChange={(e) => setClientDraft({ ...clientDraft, legalName: e.target.value })} /></label><div className="form-pair"><label>Primary contact<input value={clientDraft.contactName} onChange={(e) => setClientDraft({ ...clientDraft, contactName: e.target.value })} /></label><label>Contact email<input type="email" value={clientDraft.contactEmail} onChange={(e) => setClientDraft({ ...clientDraft, contactEmail: e.target.value })} /></label></div><button className="btn-primary" disabled={busy}>Create client</button></form> : null}
    </div> : null}

    {!loading && tab === 'contracts' ? <div className="operations-split">
      <section className="card"><div className="section-heading"><h2>Active agreements</h2><span className="count-pill">{visibleContracts.length}</span></div><div className="operations-list">{visibleContracts.map((contract) => <article className="operations-row" key={contract.id}><div className="entity-icon plan">C</div><div><strong>{contract.name}</strong><div className="muted">{contract.client.displayName}{contract.reference ? ` · ${contract.reference}` : ''}</div></div><div className="entity-stats"><span>{contract.sites.length} service location{contract.sites.length === 1 ? '' : 's'}</span><span>{contract.startDate ? new Date(contract.startDate).toLocaleDateString('en-IE') : 'Open start'} → {contract.endDate ? new Date(contract.endDate).toLocaleDateString('en-IE') : 'ongoing'}</span></div><span className={`status-badge ${contract.status === 'active' ? 'Completed' : 'Pending'}`}>{contract.status}</span></article>)}{!visibleContracts.length ? <div className="empty-state">No contracts found.</div> : null}</div></section>
      {canManage ? <form className="operations-form" onSubmit={submitContract}><div><span className="eyebrow">Commercial operations</span><h2>New contract</h2><p className="muted">Bind the client, dates and locations before scheduling work.</p></div><label>Client<select required value={contractDraft.clientId} onChange={(e) => setContractDraft({ ...contractDraft, clientId: e.target.value, siteIds: [] })}><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.displayName}</option>)}</select></label><label>Contract name<input required value={contractDraft.name} onChange={(e) => setContractDraft({ ...contractDraft, name: e.target.value })} /></label><label>Reference<input value={contractDraft.reference} onChange={(e) => setContractDraft({ ...contractDraft, reference: e.target.value })} /></label><div className="form-pair"><label>Start date<input type="date" value={contractDraft.startDate} onChange={(e) => setContractDraft({ ...contractDraft, startDate: e.target.value })} /></label><label>End date<input type="date" value={contractDraft.endDate} onChange={(e) => setContractDraft({ ...contractDraft, endDate: e.target.value })} /></label></div><fieldset><legend>Service locations</legend>{sites.filter((site) => site.clientId === contractDraft.clientId).map((site) => <label className="row tight" key={site.id}><input type="checkbox" checked={contractDraft.siteIds.includes(site.id)} onChange={(e) => setContractDraft((current) => ({ ...current, siteIds: e.target.checked ? [...current.siteIds, site.id] : current.siteIds.filter((id) => id !== site.id) }))} />{site.name}</label>)}{!sites.some((site) => site.clientId === contractDraft.clientId) ? <span className="muted">Create a client site first.</span> : null}</fieldset><button className="btn-primary" disabled={busy || !contractDraft.clientId || !contractDraft.siteIds.length}>Activate contract</button></form> : null}
    </div> : null}

    {!loading && tab === 'sites' ? <><div className="operations-split"><section className="card"><div className="section-heading"><h2>Service locations</h2><span className="count-pill">{visibleSites.length}</span></div><div className="operations-list">{visibleSites.map((site) => <button type="button" className="operations-row operations-row-button" key={site.id} onClick={() => void openSite(site.id)}><div className="entity-icon site">S</div><div><strong>{site.name}</strong><div className="muted">{site.client.displayName} · {site.addressLine1}, {site.city}</div></div><div className="entity-stats"><span>{site._count.areas} areas</span><span>{site._count.servicePlans} plans</span></div><span className="distance-bands">{site.geofenceVerifiedM} / {site.geofenceNearM} / {site.geofenceSuspiciousM}m</span></button>)}</div></section>{canManage ? <form className="operations-form" onSubmit={submitSite}><div><span className="eyebrow">Location intelligence</span><h2>New site</h2></div><label>Client<select required value={siteDraft.clientId} onChange={(e) => setSiteDraft({ ...siteDraft, clientId: e.target.value })}><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.displayName}</option>)}</select></label><label>Site name<input required value={siteDraft.name} onChange={(e) => setSiteDraft({ ...siteDraft, name: e.target.value })} /></label><label>Address<input required value={siteDraft.addressLine1} onChange={(e) => setSiteDraft({ ...siteDraft, addressLine1: e.target.value })} /></label><div className="form-pair"><label>City<input required value={siteDraft.city} onChange={(e) => setSiteDraft({ ...siteDraft, city: e.target.value })} /></label><label>Postcode<input required value={siteDraft.postalCode} onChange={(e) => setSiteDraft({ ...siteDraft, postalCode: e.target.value })} /></label></div><label>Entry instructions<textarea value={siteDraft.entryInstructions} onChange={(e) => setSiteDraft({ ...siteDraft, entryInstructions: e.target.value })} /></label><div className="geofence-preview"><span>Verified ≤150m</span><span>Review 151–250m</span><span>Suspicious &gt;700m</span></div><button className="btn-primary" disabled={busy || !clients.length}>Create site</button></form> : null}</div>{selectedSite ? <section className="card area-manager"><div className="section-heading"><div><span className="eyebrow">Area structure</span><h2>{selectedSite.name}</h2><p className="muted">Define rooms and zones so plans, evidence and quality scores stay precise.</p></div><button type="button" className="notice-close" onClick={() => setSelectedSite(null)}>×</button></div><div className="operations-list">{selectedSite.areas.map((area) => <article className="operations-row" key={area.id}><div className="entity-icon site">A</div><div><strong>{area.name}</strong><div className="muted">{area.type}{area.code ? ` · ${area.code}` : ''}</div></div><span className={`status-badge ${area.active ? 'Completed' : 'Pending'}`}>{area.active ? 'active' : 'inactive'}</span></article>)}</div>{canManage ? <form className="area-form" onSubmit={submitArea}><label>Area name<input required value={areaDraft.name} onChange={(e) => setAreaDraft({ ...areaDraft, name: e.target.value })} /></label><label>Type<select value={areaDraft.type} onChange={(e) => setAreaDraft({ ...areaDraft, type: e.target.value })}><option value="room">Room</option><option value="floor">Floor</option><option value="zone">Zone</option><option value="building">Building</option><option value="external">External</option></select></label><label>Code<input value={areaDraft.code} onChange={(e) => setAreaDraft({ ...areaDraft, code: e.target.value })} /></label><button className="btn-primary" disabled={busy}>Add area</button></form> : null}</section> : null}</> : null}

    {!loading && tab === 'plans' ? <div className="operations-split"><section className="card"><div className="section-heading"><h2>Versioned service plans</h2><span className="count-pill">{visiblePlans.length}</span></div><div className="operations-list">{visiblePlans.map((plan) => <article className="operations-row plan-row" key={plan.id}><div className="entity-icon plan">P</div><div><strong>{plan.name}</strong><div className="muted">{plan.site.client.displayName} · {plan.site.name}</div></div><div className="entity-stats"><span>{plan._count.tasks} tasks</span><span>{plan.expectedDurationMinutes} min · {plan.requiredWorkers} worker{plan.requiredWorkers === 1 ? '' : 's'}</span></div><div className="row tight"><span className={`status-badge ${plan.status === 'published' ? 'Completed' : 'Pending'}`}>{plan.status} · v{plan._count.versions}</span>{canManage ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => void publishPlan(plan.id)}>Publish</button> : null}</div></article>)}</div></section>{canManage ? <form className="operations-form" onSubmit={submitPlan}><div><span className="eyebrow">Work definition</span><h2>New service plan</h2></div><label>Site<select required value={planDraft.siteId} onChange={(e) => setPlanDraft({ ...planDraft, siteId: e.target.value })}><option value="">Select site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.client.displayName} · {site.name}</option>)}</select></label><label>Plan name<input required value={planDraft.name} onChange={(e) => setPlanDraft({ ...planDraft, name: e.target.value })} /></label><div className="form-pair"><label>Expected minutes<input type="number" min="1" value={planDraft.expectedDurationMinutes} onChange={(e) => setPlanDraft({ ...planDraft, expectedDurationMinutes: Number(e.target.value) })} /></label><label>Workers<input type="number" min="1" value={planDraft.requiredWorkers} onChange={(e) => setPlanDraft({ ...planDraft, requiredWorkers: Number(e.target.value) })} /></label></div><label>Tasks <span className="muted">one per line</span><textarea required value={planDraft.tasks} onChange={(e) => setPlanDraft({ ...planDraft, tasks: e.target.value })} /></label><button className="btn-primary" disabled={busy || !sites.length}>Create draft</button></form> : null}</div> : null}
    {!loading && tab === 'sites' && selectedSite && canManage ? <section className="card preferred-team-manager"><div><span className="eyebrow">Dispatch defaults</span><h2>Preferred cleaning team</h2><p className="muted">These people are suggested first whenever this location is scheduled. They are a preference, not a bypass of availability checks.</p></div><label className="preferred-team-search">Find a person<input placeholder="Search by name or email" onChange={(event) => { const query = event.target.value.toLowerCase(); document.querySelectorAll<HTMLLabelElement>('[data-preferred-person]').forEach((row) => { row.hidden = Boolean(query) && !row.dataset.preferredPerson?.includes(query) }) }} /></label><fieldset className="team-picker"><legend>Team priorities <span>Order is saved in the same order you select</span></legend><div>{team.map((member) => <label data-preferred-person={`${member.name ?? ''} ${member.email}`.toLowerCase()} key={member.id} className={selectedSite.preferredAssignees.some((item) => item.user.id === member.id) ? 'selected' : ''}><input type="checkbox" checked={selectedSite.preferredAssignees.some((item) => item.user.id === member.id)} onChange={() => setSelectedSite((current) => current ? { ...current, preferredAssignees: current.preferredAssignees.some((item) => item.user.id === member.id) ? current.preferredAssignees.filter((item) => item.user.id !== member.id) : [...current.preferredAssignees, { user: member }] } : current)} /><b>{member.name ?? member.email}</b><small>{member.role.replace('_', ' ')}</small></label>)}</div></fieldset><button type="button" className="btn-primary" disabled={busy} onClick={() => void savePreferredTeam()}>Save preferred team</button></section> : null}
  </main>
}
