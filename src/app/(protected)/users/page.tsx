'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApiResponse, UserRole } from '../../../types'
import ListControls from '../../../components/ui/ListControls'

type MembershipRole = 'organization_admin' | 'field_supervisor' | 'scheduler' | 'employee' | 'stock_controller' | 'quality_inspector' | 'finance' | 'viewer'
type User = { id: string; email: string; name: string | null; role: UserRole; membershipRole: MembershipRole; status: 'pending' | 'active' | 'inactive'; createdAt: string }

const ROLE_OPTIONS: Array<{ value: MembershipRole; label: string; detail: string }> = [
  { value: 'organization_admin', label: 'Organization admin', detail: 'Full organization, access and audit control' },
  { value: 'field_supervisor', label: 'Field supervisor', detail: 'Dispatch, field execution, reviews, quality and supplies' },
  { value: 'scheduler', label: 'Scheduler', detail: 'Plan and dispatch work; cannot execute cleaning visits' },
  { value: 'employee', label: 'Cleaner / employee', detail: 'Own visits, time and material requests' },
  { value: 'stock_controller', label: 'Stock controller', detail: 'Materials, replenishment and stock operations' },
  { value: 'quality_inspector', label: 'Quality inspector', detail: 'Inspections, incidents and service review' },
  { value: 'finance', label: 'Finance', detail: 'Time review, payroll release and finance visibility' },
  { value: 'viewer', label: 'Viewer', detail: 'Read-only operational visibility' },
]

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const payload = (await response.json()) as ApiResponse<T>
  if (!response.ok || !payload.ok || payload.data == null) throw new Error(payload.error ?? 'Request failed')
  return payload.data
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [invite, setInvite] = useState<{ email: string; name: string; membershipRole: MembershipRole }>({ email: '', name: '', membershipRole: 'employee' })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | User['status']>('all')
  const [role, setRole] = useState<'all' | MembershipRole>('all')
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try { setUsers(await fetchJson<User[]>('/api/users')) }
    catch (error) { setToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to load users.' }) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  async function inviteUser() {
    setBusyId('invite')
    try {
      const result = await fetchJson<{ emailSent: boolean }>('/api/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invite),
      })
      setToast({ type: result.emailSent ? 'success' : 'error', message: result.emailSent ? 'Invitation sent.' : 'User created, but the invitation email failed.' })
      setInvite({ email: '', name: '', membershipRole: 'employee' })
      await refresh()
    } catch (error) { setToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to invite user.' }) }
    finally { setBusyId(null) }
  }

  async function patchStatus(id: string, value: User['status']) {
    setBusyId(id)
    try {
      await fetchJson(`/api/users/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: value }) })
      setToast({ type: 'success', message: 'Access status updated.' }); await refresh()
    } catch (error) { setToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to update access.' }) }
    finally { setBusyId(null) }
  }

  async function changeRole(user: User, next: MembershipRole) {
    if (next === user.membershipRole) return
    const nextLabel = ROLE_OPTIONS.find((item) => item.value === next)?.label ?? next
    if (!window.confirm(`Change ${user.name ?? user.email} from ${ROLE_OPTIONS.find((item) => item.value === user.membershipRole)?.label ?? user.membershipRole} to ${nextLabel}? Access changes immediately.`)) return
    setBusyId(user.id)
    try {
      await fetchJson(`/api/users/${user.id}/role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ membershipRole: next }) })
      setToast({ type: 'success', message: `Role changed to ${nextLabel}.` }); await refresh()
    } catch (error) { setToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to update role.' }) }
    finally { setBusyId(null) }
  }

  async function resendInvite(user: User) {
    setBusyId(user.id)
    try {
      const result = await fetchJson<{ emailSent: boolean }>(`/api/users/${user.id}/invite`, { method: 'POST' })
      setToast({ type: result.emailSent ? 'success' : 'error', message: result.emailSent ? `Invitation resent to ${user.email}.` : 'A new link was created, but the email failed.' })
    } catch (error) { setToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to resend invitation.' }) }
    finally { setBusyId(null) }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return users.filter((user) =>
      (status === 'all' || user.status === status) &&
      (role === 'all' || user.membershipRole === role) &&
      (!needle || `${user.name ?? ''} ${user.email} ${user.membershipRole}`.toLowerCase().includes(needle)))
  }, [users, query, status, role])

  return <main className="page-shell access-page">
    <header className="page-header"><div><span className="eyebrow">Identity & operational access</span><h1>People & access</h1><p className="muted">Give each person the role they actually perform. Scheduling permission and cleaning execution are separate responsibilities.</p></div></header>

    <section className="card access-invite" aria-labelledby="invite-title">
      <div className="section-heading"><div><h2 id="invite-title">Invite a person</h2><p className="muted">Secure invitation expires in 24 hours.</p></div></div>
      <div className="admin-form-grid">
        <label><span>Full name</span><input value={invite.name} onChange={(event) => setInvite((current) => ({ ...current, name: event.target.value }))} /></label>
        <label><span>Work email</span><input type="email" value={invite.email} onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))} /></label>
        <label><span>Operational role</span><select value={invite.membershipRole} onChange={(event) => setInvite((current) => ({ ...current, membershipRole: event.target.value as MembershipRole }))}>{ROLE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><small>{ROLE_OPTIONS.find((item) => item.value === invite.membershipRole)?.detail}</small></label>
        <button className="btn-primary" type="button" disabled={busyId === 'invite' || !invite.name.trim() || !invite.email.trim()} onClick={() => void inviteUser()}>{busyId === 'invite' ? 'Sending…' : 'Send invitation'}</button>
      </div>
    </section>

    <section className="card" aria-labelledby="directory-title">
      <div className="section-heading"><div><h2 id="directory-title">Organization directory</h2><p className="muted">{filtered.length} of {users.length} people shown</p></div></div>
      <div className="admin-toolbar access-toolbar">
        <ListControls query={query} onQueryChange={setQuery} placeholder="Search name, email or role…" hasActiveFilters={Boolean(query.trim() || status !== 'all' || role !== 'all')} onClear={() => { setQuery(''); setStatus('all'); setRole('all') }} />
        <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <select aria-label="Filter by operational role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="all">All roles</option>{ROLE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      </div>
      {loading ? <div role="status" className="empty-state">Loading people…</div> : null}
      {!loading && !filtered.length ? <div className="empty-state">No people match these filters.</div> : null}
      <div className="admin-list access-list">
        {filtered.map((user) => <article key={user.id} className="admin-user-row access-user-row">
          <div><strong>{user.name ?? user.email}</strong><div className="muted">{user.email}</div></div>
          <label className="access-role-control"><span className="sr-only">Role for {user.name ?? user.email}</span><select aria-label={`Role for ${user.name ?? user.email}`} disabled={busyId === user.id} value={user.membershipRole} onChange={(event) => void changeRole(user, event.target.value as MembershipRole)}>{ROLE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><small>{ROLE_OPTIONS.find((item) => item.value === user.membershipRole)?.detail}</small></label>
          <span className={`status-badge ${user.status === 'active' ? 'Completed' : user.status === 'pending' ? 'Pending' : 'Cancelled'}`}>{user.status}</span>
          <div className="row tight">
            {user.status === 'pending' ? <button className="btn-secondary" type="button" disabled={busyId === user.id} onClick={() => void resendInvite(user)}>Resend invite</button> : null}
            {user.status !== 'active' ? <button className="btn-success" type="button" disabled={busyId === user.id} onClick={() => void patchStatus(user.id, 'active')}>Activate</button> : null}
            {user.status === 'active' ? <button className="btn-ghost danger" type="button" disabled={busyId === user.id} onClick={() => { if (window.confirm(`Deactivate ${user.name ?? user.email}? They will lose organization access immediately.`)) void patchStatus(user.id, 'inactive') }}>Deactivate</button> : null}
          </div>
        </article>)}
      </div>
    </section>
    {toast ? <div className={`toast toast-strong ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>{toast.message}<button className="notice-close" onClick={() => setToast(null)} aria-label="Dismiss message">×</button></div> : null}
  </main>
}
