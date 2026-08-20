'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ApiResponse, UserRole } from '../../../types'

type User = { id: string; email: string; name: string | null; role: UserRole; status: 'pending' | 'active' | 'inactive'; createdAt: string }

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [invite, setInvite] = useState<{ email: string; name: string; role: UserRole }>({ email: '', name: '', role: 'employee' })
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | User['status']>('all')
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
    const payload = (await response.json()) as ApiResponse<T>
    if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error ?? 'Request failed')
    return payload.data
  }

  async function refresh() {
    setLoading(true)
    try { setUsers(await fetchJson<User[]>('/api/users')) }
    catch (error) { setToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to load users.' }) }
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [])

  async function inviteUser() {
    try {
      const result = await fetchJson<{ emailSent: boolean }>('/api/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invite),
      })
      setToast({ type: result.emailSent ? 'success' : 'error', message: result.emailSent ? 'Invitation sent.' : 'User created, but the invitation email failed.' })
      setInvite({ email: '', name: '', role: 'employee' })
      await refresh()
    } catch (error) { setToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to invite user.' }) }
  }

  async function patchUser<T>(id: string, field: 'status' | 'role', value: string) {
    try {
      await fetchJson<T>(`/api/users/${id}/${field}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }),
      })
      setToast({ type: 'success', message: `User ${field} updated.` })
      await refresh()
    } catch (error) { setToast({ type: 'error', message: error instanceof Error ? error.message : `Failed to update ${field}.` }) }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return users.filter((user) => (status === 'all' || user.status === status) && (!needle || `${user.name ?? ''} ${user.email}`.toLowerCase().includes(needle)))
  }, [users, query, status])

  return (
    <main className="page-shell">
      <header className="page-header"><h1>User Management</h1><p className="muted">Invite people and control access without exposing security credentials.</p></header>
      <section className="card" aria-labelledby="invite-title">
        <div className="section-heading"><h2 id="invite-title">Invite a user</h2><span className="muted">Secure link expires in 24 hours</span></div>
        <div className="admin-form-grid">
          <label><span>Full name</span><input value={invite.name} onChange={(event) => setInvite((current) => ({ ...current, name: event.target.value }))} /></label>
          <label><span>Work email</span><input type="email" value={invite.email} onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))} /></label>
          <label><span>Role</span><select value={invite.role} onChange={(event) => setInvite((current) => ({ ...current, role: event.target.value as UserRole }))}><option value="employee">Employee</option><option value="supervisor">Supervisor</option><option value="viewer">Viewer</option><option value="admin">Administrator</option></select></label>
          <button className="btn-primary" type="button" disabled={!invite.name.trim() || !invite.email.trim()} onClick={() => void inviteUser()}>Send invitation</button>
        </div>
      </section>
      <section className="card" aria-labelledby="directory-title">
        <div className="section-heading"><h2 id="directory-title">Directory</h2><span className="count-pill">{filtered.length}</span></div>
        <div className="admin-toolbar">
          <input type="search" placeholder="Search name or email…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All statuses</option><option value="pending">Pending</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        </div>
        {loading ? <div role="status" className="empty-state">Loading users…</div> : null}
        {!loading && filtered.length === 0 ? <div className="empty-state">No users match these filters.</div> : null}
        <div className="admin-list">
          {filtered.map((user) => (
            <article key={user.id} className="admin-user-row">
              <div><strong>{user.name ?? user.email}</strong><div className="muted">{user.email}</div></div>
              <select aria-label={`Role for ${user.name ?? user.email}`} value={user.role} onChange={(event) => void patchUser(user.id, 'role', event.target.value)}><option value="employee">Employee</option><option value="supervisor">Supervisor</option><option value="viewer">Viewer</option><option value="admin">Administrator</option></select>
              <span className={`status-badge ${user.status === 'active' ? 'Completed' : user.status === 'pending' ? 'Pending' : 'Cancelled'}`}>{user.status}</span>
              <div className="row tight">
                {user.status !== 'active' ? <button className="btn-success" type="button" onClick={() => void patchUser(user.id, 'status', 'active')}>Activate</button> : null}
                {user.status === 'active' ? <button className="btn-ghost danger" type="button" onClick={() => void patchUser(user.id, 'status', 'inactive')}>Deactivate</button> : null}
              </div>
            </article>
          ))}
        </div>
      </section>
      {toast ? <div className={`toast toast-strong ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>{toast.message}</div> : null}
    </main>
  )
}
