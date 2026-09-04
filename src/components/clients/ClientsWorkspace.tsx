'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import DetailDialog from '../ui/DetailDialog'
import OpsIcon from '../ui/OpsIcon'
import StandardSelect from '../ui/StandardSelect'
import GooglePlaceAutocomplete, { type PlaceSelection } from '../workforce/GooglePlaceAutocomplete'
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

type ClientPlaceSelection = PlaceSelection & {
  addressLine1: string
  city: string | null
  region: string | null
  postalCode: string | null
  countryCode: string | null
}

const CLIENT_TYPE_OPTIONS = [
  { value: 'commercial', label: 'Commercial' },
  { value: 'residential', label: 'Residential' },
  { value: 'public_sector', label: 'Public sector' },
  { value: 'internal', label: 'Internal' },
]

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Request failed')
  return body.data as T
}

export default function ClientsWorkspace({ canManageClients }: { canManageClients: boolean }) {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createdClientId, setCreatedClientId] = useState<string | null>(null)
  const [clientDraft, setClientDraft] = useState({ displayName: '', legalName: '', type: 'commercial', contactName: '', contactEmail: '', contactPhone: '', billingEmail: '' })
  const [locationDraft, setLocationDraft] = useState({ name: '', addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '', countryCode: 'IE', entryInstructions: '' })
  const [addressQuery, setAddressQuery] = useState('')
  const [selectedPlace, setSelectedPlace] = useState<ClientPlaceSelection | null>(null)

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
    setCreatedClientId(null)
    setClientDraft({ displayName: '', legalName: '', type: 'commercial', contactName: '', contactEmail: '', contactPhone: '', billingEmail: '' })
    setLocationDraft({ name: '', addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '', countryCode: 'IE', entryInstructions: '' })
    setAddressQuery('')
    setSelectedPlace(null)
  }

  function selectAddress(place: PlaceSelection) {
    const resolved = place as ClientPlaceSelection
    setSelectedPlace(resolved)
    setAddressQuery(resolved.formattedAddress)
    setLocationDraft((current) => ({
      ...current,
      addressLine1: resolved.addressLine1 || resolved.formattedAddress.split(',')[0]?.trim() || '',
      city: resolved.city || '',
      region: resolved.region || '',
      postalCode: resolved.postalCode || '',
      countryCode: resolved.countryCode || 'IE',
    }))
  }

  async function createClient(event: FormEvent) {
    event.preventDefault()
    setNotice(null)
    if (!selectedPlace) {
      setNotice({ kind: 'error', text: 'Select the service address from the Google Maps suggestions. Every operational client needs at least one verified service location.' })
      return
    }
    if (!locationDraft.addressLine1.trim() || !locationDraft.city.trim() || !locationDraft.postalCode.trim()) {
      setNotice({ kind: 'error', text: 'The selected Google Maps address must include a street, city and Eircode/postcode before the client can be activated.' })
      return
    }

    setBusy(true)
    let clientId = createdClientId
    try {
      if (!clientId) {
        const client = await api<{ id: string }>('/api/clients', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            displayName: clientDraft.displayName,
            legalName: clientDraft.legalName || null,
            type: clientDraft.type,
            billingEmail: clientDraft.billingEmail || null,
            phone: clientDraft.contactPhone || null,
            contacts: clientDraft.contactName ? [{
              name: clientDraft.contactName,
              email: clientDraft.contactEmail || null,
              phone: clientDraft.contactPhone || null,
              isPrimary: true,
            }] : [],
          }),
        })
        clientId = client.id
        setCreatedClientId(client.id)
      }

      await api('/api/sites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          clientId,
          name: clientDraft.type === 'residential' ? 'Home' : locationDraft.name.trim() || clientDraft.displayName,
          addressLine1: locationDraft.addressLine1,
          addressLine2: locationDraft.addressLine2 || null,
          city: locationDraft.city,
          region: locationDraft.region || null,
          postalCode: locationDraft.postalCode,
          countryCode: locationDraft.countryCode || 'IE',
          timezone: 'Europe/Dublin',
          latitude: selectedPlace.latitude,
          longitude: selectedPlace.longitude,
          coordinateSource: 'geocoded',
          geofenceVerifiedM: 150,
          geofenceNearM: 250,
          geofenceSuspiciousM: 700,
          access: { entryInstructions: locationDraft.entryInstructions || null },
          areas: [{ name: 'Main area', type: 'zone', sortOrder: 0 }],
          preferredAssigneeIds: [],
          contractIds: [],
        }),
      })

      const destination = `/clients/${clientId}?setup=1`
      resetCreate()
      setCreateOpen(false)
      router.push(destination)
    } catch (error) {
      setNotice({
        kind: 'error',
        text: `${error instanceof Error ? error.message : 'Could not finish the client account.'}${clientId ? ' The client account is already saved; retry will only finish the service location.' : ''}`,
      })
      await refresh()
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
      <StandardSelect
        className="clients-filter-select"
        value={typeFilter}
        onChange={setTypeFilter}
        ariaLabel="Client type"
        options={[{ value: 'all', label: 'All client types' }, ...CLIENT_TYPE_OPTIONS]}
      />
    </section>

    <section className="clients-list" aria-label="Client accounts">
      {visible.map((client) => {
        const contact = client.contacts.find((item) => item.isPrimary) ?? client.contacts[0]
        return <Link className="client-list-card" href={`/clients/${client.id}`} key={client.id}>
          <div className="client-list-main"><div className="client-avatar">{client.displayName.slice(0, 2).toUpperCase()}</div><div><strong>{client.displayName}</strong><span>{client.type === 'residential' ? 'Residential' : client.type === 'commercial' ? 'Commercial' : client.type.replaceAll('_', ' ')} · {contact?.name ?? client.billingEmail ?? 'Contact not set'}</span></div></div>
          <div className="client-list-meta"><div><strong>{client._count.sites}</strong><span>location{client._count.sites === 1 ? '' : 's'}</span></div><div><strong>{client._count.contracts}</strong><span>service agreement{client._count.contracts === 1 ? '' : 's'}</span></div></div>
          <div><span className={`client-state ${client.status}`}>{client.status}</span><span className="client-list-arrow">→</span></div>
        </Link>
      })}
      {!loading && !visible.length ? <div className="client-empty"><strong>No clients match this view</strong><span>Clear the search or add the first customer account.</span>{canManageClients ? <button className="client-button" onClick={() => { resetCreate(); setCreateOpen(true) }}>New client</button> : null}</div> : null}
      {loading ? <div className="client-loading">Loading client portfolio…</div> : null}
    </section>

    <DetailDialog open={createOpen} title="New client" eyebrow="Client setup" onClose={() => setCreateOpen(false)}>
      <form className="client-dialog-form" onSubmit={createClient}>
        {createdClientId ? <div className="client-setup-note"><OpsIcon name="check" /><div><strong>Client account saved</strong><span>Finish the service location below. Retrying will not create the client twice.</span></div></div> : null}

        <section className="client-create-section">
          <div className="client-create-section-head"><span>Client</span><p>Who we are cleaning for.</p></div>
          <label>Client name<input required autoFocus value={clientDraft.displayName} onChange={(event) => setClientDraft({ ...clientDraft, displayName: event.target.value })} placeholder="Merrion Dental Group" /></label>
          <div className="client-form-field"><span>Client type</span><StandardSelect value={clientDraft.type} onChange={(value) => { setClientDraft({ ...clientDraft, type: value }); if (value === 'residential') setLocationDraft((current) => ({ ...current, name: '' })) }} ariaLabel="Client type" options={CLIENT_TYPE_OPTIONS} /></div>
          <label>Legal name <small>Optional</small><input value={clientDraft.legalName} onChange={(event) => setClientDraft({ ...clientDraft, legalName: event.target.value })} /></label>
          <div className="client-form-pair"><label>Primary contact <small>Optional</small><input value={clientDraft.contactName} onChange={(event) => setClientDraft({ ...clientDraft, contactName: event.target.value })} /></label><label>Contact email <small>Optional</small><input type="email" value={clientDraft.contactEmail} onChange={(event) => setClientDraft({ ...clientDraft, contactEmail: event.target.value })} /></label></div>
          <div className="client-form-pair"><label>Contact phone <small>Optional</small><input value={clientDraft.contactPhone} onChange={(event) => setClientDraft({ ...clientDraft, contactPhone: event.target.value })} /></label><label>Billing email <small>Optional</small><input type="email" value={clientDraft.billingEmail} onChange={(event) => setClientDraft({ ...clientDraft, billingEmail: event.target.value })} /></label></div>
        </section>

        <section className="client-create-section location">
          <div className="client-create-section-head"><span>Service location</span><p>Every operational client needs the verified address where cleaning will happen.</p></div>
          {clientDraft.type === 'residential' ? <div className="client-setup-note"><OpsIcon name="map" /><div><strong>Location: Home</strong><span>Residential clients use Home automatically. You only need to confirm the address.</span></div></div> : <label>Location name <small>Optional · name shown to the team, e.g. Ranelagh Clinic</small><input value={locationDraft.name} onChange={(event) => setLocationDraft({ ...locationDraft, name: event.target.value })} placeholder="Site name" /></label>}
          <GooglePlaceAutocomplete
            kind="home"
            label="Service address"
            value={addressQuery}
            placeholder="Start typing an address or Eircode…"
            selected={selectedPlace}
            onValueChange={(value) => {
              setAddressQuery(value)
              if (selectedPlace && value !== selectedPlace.formattedAddress) {
                setSelectedPlace(null)
                setLocationDraft((current) => ({ ...current, addressLine1: '', city: '', region: '', postalCode: '' }))
              }
            }}
            onSelect={selectAddress}
            helpText="Required · choose the correct Google Maps result. Its verified coordinates power Map, routing and geofence checks."
          />
          <label>Address line 2 <small>Optional</small><input value={locationDraft.addressLine2} onChange={(event) => setLocationDraft({ ...locationDraft, addressLine2: event.target.value })} placeholder="Unit, floor or building detail" /></label>
          <div className="client-form-pair"><label>City <small>From Google Maps</small><input readOnly aria-readonly="true" value={locationDraft.city} placeholder="Select an address above" /></label><label>Eircode / postcode <small>From Google Maps</small><input readOnly aria-readonly="true" value={locationDraft.postalCode} placeholder="Select an address above" /></label></div>
          <label>Entry notes <small>Optional</small><textarea rows={3} value={locationDraft.entryInstructions} onChange={(event) => setLocationDraft({ ...locationDraft, entryInstructions: event.target.value })} placeholder="Reception, keys, parking or access instructions…" /></label>
        </section>

        <div className="client-dialog-actions"><button type="button" className="client-button-secondary" onClick={() => setCreateOpen(false)}>Cancel</button><button className="client-button" disabled={busy}>{busy ? 'Saving…' : createdClientId ? 'Retry service location' : 'Create client & continue to service setup'}</button></div>
      </form>
    </DetailDialog>
  </main>
}
