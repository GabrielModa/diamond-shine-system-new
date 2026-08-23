'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import ListControls from '../ui/ListControls'

type Contact = { id: string; name: string; email?: string | null; phone?: string | null; isPrimary: boolean }
type Client = { id: string; displayName: string; legalName?: string | null; type: string; status: string; billingEmail?: string | null; phone?: string | null; contacts: Contact[]; _count: { sites: number; contracts: number } }

async function getClients(search: string): Promise<Client[]> {
  const response = await fetch(`/api/clients${search ? `?search=${encodeURIComponent(search)}` : ''}`, { credentials: 'include', cache: 'no-store' })
  const body = await response.json()
  if (!response.ok || !body.ok) throw new Error(body.error ?? 'Could not load clients.')
  return body.data as Client[]
}

export default function ClientsWorkspace() {
  const [clients, setClients] = useState<Client[]>([])
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setClients(await getClients(search)) } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load clients.') } finally { setLoading(false) }
  }, [search])

  useEffect(() => { const timer = window.setTimeout(() => { void refresh() }, 180); return () => window.clearTimeout(timer) }, [refresh])
  const selected = useMemo(() => clients.find((client) => client.id === selectedId) ?? clients[0] ?? null, [clients, selectedId])
  const active = clients.filter((client) => client.status === 'active').length
  const sites = clients.reduce((total, client) => total + client._count.sites, 0)

  return <main className="page-shell manager-page">
    <header className="manager-header">
      <div><span className="eyebrow">Customer operations</span><h1>Clients</h1><p className="muted">One operational record for every contract, site, contact and active service.</p></div>
      <a className="btn-primary" href="/operations">+ New client</a>
    </header>
    <section className="manager-kpis" aria-label="Client overview">
      <article><span>Active clients</span><strong>{active}</strong><small>Ready for scheduled work</small></article>
      <article><span>Sites managed</span><strong>{sites}</strong><small>Across the selected portfolio</small></article>
      <article><span>Service records</span><strong>{clients.reduce((total, client) => total + client._count.contracts, 0)}</strong><small>Contracts in the system</small></article>
      <article className="manager-kpi-action"><strong>Keep records clean</strong><small>Search before creating a client to prevent duplicates.</small></article>
    </section>
    {message ? <div className="toast success" role="status">{message}<button className="notice-close" onClick={() => setMessage(null)}>×</button></div> : null}
    <section className="manager-workspace">
      <div className="manager-list card">
        <div className="manager-list-toolbar"><div><h2>All clients</h2><span className="muted">{loading ? 'Loading…' : `${clients.length} result${clients.length === 1 ? '' : 's'}`}</span></div><ListControls query={search} onQueryChange={setSearch} placeholder="Search client, company or site…" /></div>
        <div className="manager-table scroll-list" role="table" aria-label="Clients">
          <div className="manager-table-head" role="row"><span>Client</span><span>Sites</span><span>Service records</span><span>Status</span></div>
          {clients.map((client) => <button className={selected?.id === client.id ? 'manager-row selected' : 'manager-row'} key={client.id} onClick={() => setSelectedId(client.id)}><span><b>{client.displayName}</b><small>{client.legalName || client.billingEmail || 'No billing contact yet'}</small></span><span>{client._count.sites}</span><span>{client._count.contracts}</span><span className={`status-badge ${client.status === 'active' ? 'Completed' : 'Pending'}`}>{client.status}</span></button>)}
          {!loading && !clients.length ? <div className="empty-state">No clients match this search.</div> : null}
        </div>
      </div>
      <aside className="manager-detail card" aria-live="polite">
        {selected ? <><span className="eyebrow">Client record</span><h2>{selected.displayName}</h2><span className={`status-badge ${selected.status === 'active' ? 'Completed' : 'Pending'}`}>{selected.status}</span><dl><div><dt>Sites</dt><dd>{selected._count.sites}</dd></div><div><dt>Service records</dt><dd>{selected._count.contracts}</dd></div><div><dt>Billing</dt><dd>{selected.billingEmail || 'Not set'}</dd></div><div><dt>Phone</dt><dd>{selected.phone || 'Not set'}</dd></div></dl><section><h3>Primary contact</h3>{selected.contacts.filter((contact) => contact.isPrimary).map((contact) => <p key={contact.id}><b>{contact.name}</b><br /><span className="muted">{contact.email || contact.phone || 'Contact details not set'}</span></p>)}{!selected.contacts.some((contact) => contact.isPrimary) ? <p className="muted">No primary contact recorded.</p> : null}</section><a className="btn-secondary full-width" href="/operations">Open service setup →</a></> : <div className="empty-state">Select a client to see its operational record.</div>}
      </aside>
    </section>
  </main>
}
