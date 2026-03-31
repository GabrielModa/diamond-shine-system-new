'use client'

import { useEffect, useState } from 'react'
import type { ApiResponse } from '../../../types'

type User = {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'supervisor' | 'employee' | 'viewer'
  status: 'pending' | 'active' | 'inactive'
  createdAt: string
}

type Template = {
  id: string
  key: string
  subject: string
  body: string
  updatedAt: string
}

type AuditLog = {
  id: string
  actorEmail: string
  action: string
  targetType: string
  targetId: string | null
  metadata: string | null
  createdAt: string
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [invite, setInvite] = useState({ email: '', name: '', role: 'employee' })
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [alerts, setAlerts] = useState({ supplyAlerts: '', feedbackAlerts: '' })
  const invitePreviewData = {
    name: 'Maria Silva',
    email: 'maria@diamondshine.ie',
    tempPassword: 'TempPass123!',
    inviteUrl: 'https://diamondshine.ie/login',
  }

  function renderTemplate(value: string, data: Record<string, string>) {
    return Object.entries(data).reduce((acc, [key, val]) => acc.replaceAll(`{{${key}}}`, val), value)
  }

  async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
    const payload = (await res.json()) as ApiResponse<T>
    if (!payload.ok || !payload.data) throw new Error(payload.error || 'Request failed')
    return payload.data
  }

  async function refresh() {
    try {
      const [usersData, templatesData, auditData, alertData] = await Promise.all([
        fetchJson<User[]>('/api/users'),
        fetchJson<Template[]>('/api/templates'),
        fetchJson<AuditLog[]>('/api/audit?limit=20'),
        fetchJson<{ supplyAlerts: string; feedbackAlerts: string }>('/api/settings'),
      ])
      setUsers(usersData)
      setTemplates(templatesData)
      setLogs(auditData)
      setAlerts(alertData)
    } catch {
      setToast({ type: 'error', message: 'Failed to load admin data.' })
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function updateStatus(id: string, status: User['status']) {
    try {
      await fetch(`/api/users/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      setToast({ type: 'success', message: `User status updated to ${status}.` })
      await refresh()
    } catch {
      setToast({ type: 'error', message: 'Failed to update user status.' })
    }
  }

  async function updateRole(id: string, role: User['role']) {
    try {
      await fetch(`/api/users/${id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      setToast({ type: 'success', message: `Role updated to ${role}.` })
      await refresh()
    } catch {
      setToast({ type: 'error', message: 'Failed to update role.' })
    }
  }

  async function inviteUser() {
    try {
      const res = await fetchJson<{ id: string; tempPassword: string; emailSent: boolean }>('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invite),
      })
      const emailNote = res.emailSent ? 'Invite email sent.' : 'Invite created, but email failed.'
      setToast({ type: res.emailSent ? 'success' : 'error', message: `${emailNote} Temp password: ${res.tempPassword}` })
      setInvite({ email: '', name: '', role: 'employee' })
      await refresh()
    } catch {
      setToast({ type: 'error', message: 'Failed to invite user.' })
    }
  }

  async function saveTemplate(template: Template) {
    try {
      await fetchJson<Template>('/api/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: template.key, subject: template.subject, body: template.body }),
      })
      setToast({ type: 'success', message: 'Template saved.' })
      await refresh()
    } catch {
      setToast({ type: 'error', message: 'Failed to save template.' })
    }
  }

  async function saveAlerts() {
    try {
      await fetchJson<{ ok: true }>('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alerts),
      })
      setToast({ type: 'success', message: 'Notification emails updated.' })
      await refresh()
    } catch {
      setToast({ type: 'error', message: 'Failed to update notifications.' })
    }
  }

  const pending = users.filter((user) => user.status === 'pending')
  const active = users.filter((user) => user.status === 'active')
  const inactive = users.filter((user) => user.status === 'inactive')

  return (
    <main className="page-shell">
      <div className="top-bar">
        <a href="/home">← Back</a>
        <div className="role-pill">Admin</div>
      </div>
      <div className="page-header">
        <h1>User Management</h1>
        <p className="muted">Invite, approve, and manage access across the team.</p>
      </div>

      <div className="card">
        <h2>
          <span className="title-icon">✉️</span>
          Invite New User
        </h2>
        <div className="row">
          <input
            placeholder="Email"
            value={invite.email}
            onChange={(event) => setInvite((prev) => ({ ...prev, email: event.target.value }))}
          />
          <input
            placeholder="Full name"
            value={invite.name}
            onChange={(event) => setInvite((prev) => ({ ...prev, name: event.target.value }))}
          />
          <select
            value={invite.role}
            onChange={(event) => setInvite((prev) => ({ ...prev, role: event.target.value }))}
          >
            <option value="employee">Employee</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
            <option value="viewer">Viewer</option>
          </select>
          <button type="button" onClick={inviteUser}>
            Send Invite
          </button>
        </div>
      </div>

      <div className="card section-card">
        <h2>
          <span className="title-icon">🕒</span>
          Pending Approvals
        </h2>
        {pending.length === 0 ? <div className="muted">No pending users.</div> : null}
        {pending.map((user) => (
          <div key={user.id} className="list-item">
            <div className="list-main">
              <div className="list-title">{user.name ?? user.email}</div>
              <div className="muted">{user.email}</div>
            </div>
            <div className="list-meta">
              <span className="badge normal">{user.role}</span>
              <span className="status-badge Pending">Pending</span>
            </div>
            <div className="list-actions">
              <button type="button" className="btn-success" onClick={() => updateStatus(user.id, 'active')}>
                Approve
              </button>
              <button type="button" className="btn-warning" onClick={() => updateStatus(user.id, 'inactive')}>
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card section-card">
        <h2>
          <span className="title-icon">✅</span>
          Active Users
        </h2>
        {active.map((user) => (
          <div key={user.id} className="list-item">
            <div className="list-main">
              <div className="list-title">{user.name ?? user.email}</div>
              <div className="muted">{user.email}</div>
            </div>
            <div className="list-meta">
              <select value={user.role} onChange={(event) => updateRole(user.id, event.target.value as User['role'])}>
                <option value="employee">Employee</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
              <span className="status-badge Completed">Active</span>
            </div>
            <div className="list-actions">
              <button type="button" className="btn-warning" onClick={() => updateStatus(user.id, 'inactive')}>
                Deactivate
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card section-card">
        <h2>
          <span className="title-icon">⛔</span>
          Inactive Users
        </h2>
        {inactive.length === 0 ? <div className="muted">No inactive users.</div> : null}
        {inactive.map((user) => (
          <div key={user.id} className="list-item">
            <div className="list-main">
              <div className="list-title">{user.name ?? user.email}</div>
              <div className="muted">{user.email}</div>
            </div>
            <div className="list-meta">
              <span className="badge low">{user.role}</span>
              <span className="status-badge Completed">Inactive</span>
            </div>
            <div className="list-actions">
              <button type="button" className="btn-success" onClick={() => updateStatus(user.id, 'active')}>
                Reactivate
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card section-card">
        <h2>
          <span className="title-icon">📝</span>
          Email Templates
        </h2>
        {templates.map((template) => (
          <div key={template.id} className="template-item">
            <div className="template-header">
              <span className="template-key">{template.key}</span>
              <span className="muted">Last updated: {new Date(template.updatedAt).toLocaleDateString('en-IE')}</span>
            </div>
            {template.key === 'user_invite' ? (
              <div className="template-preview muted">
                Placeholders: {'{{name}}'}, {'{{email}}'}, {'{{tempPassword}}'}, {'{{inviteUrl}}'}
              </div>
            ) : null}
            <div className="template-grid">
              <div className="template-label">Subject</div>
              <input
                value={template.subject}
                onChange={(event) =>
                  setTemplates((prev) =>
                    prev.map((item) => (item.id === template.id ? { ...item, subject: event.target.value } : item))
                  )
                }
              />
              <div className="template-label">Body</div>
              <textarea
                value={template.body}
                onChange={(event) =>
                  setTemplates((prev) =>
                    prev.map((item) => (item.id === template.id ? { ...item, body: event.target.value } : item))
                  )
                }
              />
            </div>
            {template.key === 'user_invite' ? (
              <div className="template-preview">
                <div className="template-preview-title">Preview</div>
                <div className="template-preview-card">
                  <div className="template-preview-subject">
                    {renderTemplate(template.subject, invitePreviewData)}
                  </div>
                  <div
                    className="template-preview-body"
                    dangerouslySetInnerHTML={{
                      __html: renderTemplate(template.body, invitePreviewData),
                    }}
                  />
                </div>
              </div>
            ) : null}
            <div className="template-actions">
              <button type="button" className="btn-primary" onClick={() => saveTemplate(template)}>
                Save Template
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card section-card">
        <h2>
          <span className="title-icon">🔔</span>
          Notification Emails
        </h2>
        <div className="template-item">
          <div className="template-header">
            <span className="template-key">Supplies alerts</span>
            <span className="muted">Comma-separated emails</span>
          </div>
          <input
            value={alerts.supplyAlerts}
            placeholder="alerts@company.com, manager@company.com"
            onChange={(event) => setAlerts((prev) => ({ ...prev, supplyAlerts: event.target.value }))}
          />
        </div>
        <div className="template-item">
          <div className="template-header">
            <span className="template-key">Feedback alerts</span>
            <span className="muted">Comma-separated emails</span>
          </div>
          <input
            value={alerts.feedbackAlerts}
            placeholder="quality@company.com"
            onChange={(event) => setAlerts((prev) => ({ ...prev, feedbackAlerts: event.target.value }))}
          />
        </div>
        <div className="template-actions">
          <button type="button" className="btn-primary" onClick={saveAlerts}>
            Save notifications
          </button>
        </div>
      </div>

      <div className="card section-card">
        <h2>
          <span className="title-icon">🧾</span>
          Audit Log
        </h2>
        {logs.map((log) => (
          <div key={log.id} className="list-item">
            <div className="list-main">
              <div className="list-title">{log.action}</div>
              <div className="muted">{log.actorEmail}</div>
            </div>
            <div className="list-meta">
              <span className="badge normal">{log.targetType}</span>
              <span className="muted">{new Date(log.createdAt).toLocaleString('en-IE')}</span>
            </div>
          </div>
        ))}
      </div>

      {toast ? <div className={`toast ${toast.type}`}>{toast.message}</div> : null}
    </main>
  )
}
