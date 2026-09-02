'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import DetailDialog from '../ui/DetailDialog'
import OpsIcon from '../ui/OpsIcon'
import './ClientsWorkspace.css'

type Contact = { id: string; name: string; email?: string | null; phone?: string | null; isPrimary: boolean }
type Client = {
  id: string
  displayName: string
  legalName?: string | null
  type: string
  status: string
  billingEmail?: string | null
  phone?: string | null
  contacts: Contact[]
  _count: { sites: number; contracts: number }
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Request failed')
  return body.data as T
}

export default function ClientsWorkspace({ canManageClients }: { canManageClients: boolean }) {
  const [clients, setClients] = useState<Client[]>([])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [clientDraft, setClientDraft] = useState({ displayName: '', legalName: '', type: 'commercial', contactName: '', contactEmail: '', contactPhone: '', billingEmail: '', phone: '' })
  const [locationDraft, setLocationDraft] = useState({ addNow: true, name: '', addressLine1: '', addressLine2: '', city: 'Dublin', postalCode: '', entryInstructions: '' })

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const search = query.trim()
      const rows = await api<Client[]>(`/api/clients${search ? `?search=${encodeURIComponent(search)}` : ''}`)
      setClients(rows)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load clients.' })
    } finally { setLoading(false) }
  }, [query])

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 180); return () => window.clearTimeout(timer) }, [refresh])

  const visible = useMemo(() => clients.filter((client) => typeFilter === 'all' || client.type === typeFilter), [clients, typeFilter])
  const active = clients.filter((client) => client.status === 'active').length
  const locations = clients.reduce((total, client) => total + client._count.sites, 0)
  const agreements = clients.reduce((total, client) => total + client._count.contracts, 0)
  const residential = clients.filter((client) => client.type === 'residential').length

  function resetCreate() {
    setStep(1)
    setClientDraft({ displayName: '', legalName: '', type: 'commercial', contactName: '', contactEmail: '', contactPhone: '', billingEmail: '', phone: '' })
    setLocationDraft({ addNow: true, name: '', addressLine1: '', addressLine2: '', city: 'Dublin', postalCode: '', entryInstructions: '' })
  }

  async function createClient(event: FormEvent) {
    event.preventDefault()
    if (step === 1) {
      setStep(2)
      return
    }
    setBusy(true)
    try {
      const client = await api<{ id: string }>('/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          displayName: clientDraft.displayName,
          legalName: clientDraft.legalName || null,
          type: clientDraft.type,
          billingEmail: clientDraft.billingEmail || null,
          phone: clientDraft.phone || null,
          contacts: clientDraft.contactName ? [{
            name: clientDraft.contactName,
            email: clientDraft.contactEmail || null,
            phone: clientDraft.contactPhone || null,
            isPrimary: true,
          }] : [],
        }),
      })

      if (locationDraft.addNow) {
        await api('/api/sites', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            clientId: client.id,
            name: locationDraft.name || (clientDraft.type === 'residential' ? 'Home' : clientDraft.displayName),
            addressLine1: locationDraft.addressLine1,
            addressLine2: locationDraft.addressLine2 || null,
            city: locationDraft.city,
            postalCode: locationDraft.postalCode,
            countryCode: 'IE', timezone: 'Europe/Dublin',
            geofenceVerifiedM: 150, geofenceNearM: 250, geofenceSuspiciousM: 700,
            access: { entryInstructions: locationDraft.entryInstructions || null },
            areas: [{ name: 'Main area', type: 'zone', sortOrder: 0 }],
            preferredAssigneeIds: [], contractIds: [],
          }),
        })
      }

      resetCreate()
      setCreateOpen(false)
      window.location.assign(`/clients/${client.id}${locationDraft.addNow ? '?setup=1' : ''}`)
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not create the client account.' })
    } finally { setBusy(false) }
  }

  return <main className="page-shell manager-page clients-v2">
    <header className="clients-hero">
      <div><span className="client-eyebrow">Customer operations</span><h1>Clients</h1><p>Keep each customer, location and cleaning service together. The technical contract and scheduling records stay connected behind the scenes.</p></div>
      <div className="clients-hero-actions">{canManageClients ? <button className="client-button" onClick={() => { resetCreate(); setCreateOpen(true) }}><OpsIcon name="user" />New client</button> : null}</div>
    </header>

    {notice ? <div className={`client-notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}><span>{notice.text}</span><button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div> : null}

    <section className="clients-summary" aria-label="Client portfolio summary">
      <article><span>Active clients</span><strong>{active}</strong><small>Customer accounts in service</small></article>
      <article><span>Locations</span><strong>{locations}</strong><small>Addresses where cleaning is delivered</small></article>
      <article><span>Service agreements</span><strong>{agreements}</strong><small>Commercial records linked behind the scenes</small></article>
      <article><span>Residential</span><strong>{residential}</strong><small>{Math.max(0, clients.length - residential)} commercial / other</small></article>
    </section>

    <section className="clients-toolbar" aria-label="Client filters">
      <div className="clients-search"><OpsIcon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search client, contact, address or postcode…" /></div>
      <select className="clients-filter" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Client type"><option value="all">All client types</option><option value="commercial">Commercial</option><option value="residential">Residential</option><option value="public_sector">Public sector</option><option value="internal">Internal</option></select>
    </section>

    <section className="clients-list" aria-label="Client accounts">
      {visible.map((client) => {
        const contact = client.contacts.find((item) => item.isPrimary) ?? client.contacts[0]
        return <a className="client-list-card" href={`/clients/${client.id}`} key={client.id}>
          <div className="client-list-main"><div className="client-avatar">{client.displayName.slice(0, 2).toUpperCase()}</div><div><strong>{client.displayName}</strong><span>{client.type === 'residential' ? 'Residential' : client.type === 'commercial' ? 'Commercial' : client.type.replaceAll('_', ' ')} · {contact?.name ?? client.billingEmail ?? 'Contact not set'}</span></div></div>
          <div className="client-list-meta"><div><strong>{client._count.sites}</strong><span>location{client._count.sites === 1 ? '' : 's'}</span></div><div><strong>{client._count.contracts}</strong><span>service agreement{client._count.contracts === 1 ? '' : 's'}</span></div></div>
          <div><span className={`client-state ${client.status}`}>{client.status}</span><span className="client-list-arrow">→</span></div>
        </a>
      })}
      {!loading && !visible.length ? <div className="client-empty"><strong>No clients match this view</strong><span>Clear the search or add the first customer account.</span>{canManageClients ? <button className="client-button" onClick={() => { resetCreate(); setCreateOpen(true) }}>New client</button> : null}</div> : null}
      {loading ? <div className="client-loading">Loading client portfolio…</div> : null}
    </section>

    <DetailDialog open={createOpen} title={step === 1 ? 'New client' : 'Service location'} eyebrow={`Step ${step} of 2`} onClose={() => setCreateOpen(false)}>
      <form className="client-dialog-form" onSubmit={createClient}>
        <div className="clients-create-steps"><span className={step === 1 ? 'active' : ''}>1 · Client</span><span className={step === 2 ? 'active' : ''}>2 · Location</span></div>
        {step === 1 ? <>
          <label>Client name<input required autoFocus value={clientDraft.displayName} onChange={(event) => setClientDraft({ ...clientDraft, displayName: event.target.value })} placeholder="Merrion Dental Group" /></label>
          <label>Client type<select value={clientDraft.type} onChange={(event) => setClientDraft({ ...clientDraft, type: event.target.value })}><option value="commercial">Commercial</option><option value="residential">Residential</option><option value="public_sector">Public sector</option><option value="internal">Internal</option></select></label>
          <label>Legal name <small>Optional</small><input value={clientDraft.legalName} onChange={(event) => setClientDraft({ ...clientDraft, legalName: event.target.value })} /></label>
          <div className="client-form-pair"><label>Primary contact <small>Optional</small><input value={clientDraft.contactName} onChange={(event) => setClientDraft({ ...clientDraft, contactName: event.target.value })} /></label><label>Contact email <small>Optional</small><input type="email" value={clientDraft.contactEmail} onChange={(event) => setClientDraft({ ...clientDraft, contactEmail: event.target.value })} /></label></div>
          <div className="client-form-pair"><label>Contact phone <small>Optional</small><input value={clientDraft.contactPhone} onChange={(event) => setClientDraft({ ...clientDraft, contactPhone: event.target.value })} /></label><label>Billing email <small>Optional</small><input type="email" value={clientDraft.billingEmail} onChange={(event) => setClientDraft({ ...clientDraft, billingEmail: event.target.value })} /></label></div>
        </> : <>
          <label className="clients-create-option"><input type="checkbox" checked={locationDraft.addNow} onChange={(event) => setLocationDraft({ ...locationDraft, addNow: event.target.checked })} /><span><strong>Add the first service location now</strong><span>You can skip this and add locations later from the client account.</span></span></label>
          {locationDraft.addNow ? <>
            <label>Location name <small>{clientDraft.type === 'residential' ? 'Usually Home' : 'Example: Ranelagh Clinic'}</small><input value={locationDraft.name} onChange={(event) => setLocationDraft({ ...locationDraft, name: event.target.value })} placeholder={clientDraft.type === 'residential' ? 'Home' : 'Site name'} /></label>
            <label>Address<input required value={locationDraft.addressLine1} onChange={(event) => setLocationDraft({ ...locationDraft, addressLine1: event.target.value })} /></label>
            <label>Address line 2 <small>Optional</small><input value={locationDraft.addressLine2} onChange={(event) => setLocationDraft({ ...locationDraft, addressLine2: event.target.value })} /></label>
            <div className="client-form-pair"><label>City<input required value={locationDraft.city} onChange={(event) => setLocationDraft({ ...locationDraft, city: event.target.value })} /></label><label>Postcode<input required value={locationDraft.postalCode} onChange={(event) => setLocationDraft({ ...locationDraft, postalCode: event.target.value })} /></label></div>
            <label>Entry notes <small>Optional</small><textarea rows={3} value={locationDraft.entryInstructions} onChange={(event) => setLocationDraft({ ...locationDraft, entryInstructions: event.target.value })} placeholder="Reception, keys, parking or access instructions…" /></label>
          </> : null}
        </>}
        <div className="client-dialog-actions">{step === 2 ? <button type="button" className="client-button-secondary" onClick={() => setStep(1)}>Back</button> : <button type="button" className="client-button-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>}<button className="client-button" disabled={busy}>{step === 1 ? 'Continue' : busy ? 'Creating…' : locationDraft.addNow ? 'Create & set up service' : 'Create client'}</button></div>
      </form>
    </DetailDialog>
  </main>
}
