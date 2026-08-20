'use client'

import { useEffect, useState } from 'react'
import type { ApiResponse } from '../../../types'

type Template = { id: string; key: string; subject: string; body: string; updatedAt: string }

export default function CommunicationsPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [alerts, setAlerts] = useState({ supplyAlerts: '', feedbackAlerts: '' })
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
    const payload = (await response.json()) as ApiResponse<T>
    if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error ?? 'Request failed')
    return payload.data
  }

  async function refresh() {
    try {
      const [templateData, alertData] = await Promise.all([
        fetchJson<Template[]>('/api/templates'),
        fetchJson<typeof alerts>('/api/settings'),
      ])
      setTemplates(templateData)
      setAlerts(alertData)
    } catch (error) { setToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to load communications.' }) }
  }

  useEffect(() => { void refresh() }, [])

  function render(value: string) {
    const sample: Record<string, string> = {
      name: 'Maria Silva', email: 'maria@diamondshine.ie',
      inviteUrl: 'https://diamondshine.ie/set-password?token=secure-link',
      resetUrl: 'https://diamondshine.ie/reset-password?token=secure-link',
      priority: 'urgent', employee: 'Maria Silva',
    }
    return Object.entries(sample).reduce((result, [key, replacement]) => result.replaceAll(`{{${key}}}`, replacement), value)
  }

  async function saveTemplate(template: Template) {
    try {
      await fetchJson('/api/templates', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: template.key, subject: template.subject, body: template.body }) })
      setToast({ type: 'success', message: 'Template saved.' })
      await refresh()
    } catch (error) { setToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to save template.' }) }
  }

  async function saveAlerts() {
    try {
      await fetchJson('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alerts) })
      setToast({ type: 'success', message: 'Notification recipients saved.' })
    } catch (error) { setToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to save recipients.' }) }
  }

  return (
    <main className="page-shell">
      <header className="page-header"><h1>Communications</h1><p className="muted">Control automated messages and who receives operational alerts.</p></header>
      <section className="card" aria-labelledby="recipient-title">
        <div className="section-heading"><h2 id="recipient-title">Notification recipients</h2><span className="muted">Separate multiple addresses with commas</span></div>
        <div className="admin-form-grid two-columns">
          <label><span>Supply alerts</span><input type="text" value={alerts.supplyAlerts} onChange={(event) => setAlerts((current) => ({ ...current, supplyAlerts: event.target.value }))} placeholder="operations@company.ie" /></label>
          <label><span>Feedback alerts</span><input type="text" value={alerts.feedbackAlerts} onChange={(event) => setAlerts((current) => ({ ...current, feedbackAlerts: event.target.value }))} placeholder="quality@company.ie" /></label>
        </div>
        <div className="template-actions"><button className="btn-primary" type="button" onClick={() => void saveAlerts()}>Save recipients</button></div>
      </section>
      <section aria-labelledby="template-title">
        <div className="section-heading"><h2 id="template-title">Email templates</h2><span className="muted">Preview runs in a restricted sandbox</span></div>
        <div className="communication-grid">
          {templates.map((template) => (
            <article key={template.id} className="card communication-card">
              <div className="template-header"><strong>{template.key.replaceAll('_', ' ')}</strong><span className="muted">Updated {new Date(template.updatedAt).toLocaleDateString('en-IE')}</span></div>
              <label><span>Subject</span><input value={template.subject} onChange={(event) => setTemplates((items) => items.map((item) => item.id === template.id ? { ...item, subject: event.target.value } : item))} /></label>
              <label><span>HTML body</span><textarea value={template.body} onChange={(event) => setTemplates((items) => items.map((item) => item.id === template.id ? { ...item, body: event.target.value } : item))} /></label>
              <div><span className="muted">Preview: {render(template.subject)}</span><iframe className="email-preview" sandbox="" title={`Preview of ${template.key}`} srcDoc={render(template.body)} /></div>
              <div className="template-actions"><button className="btn-primary" type="button" onClick={() => void saveTemplate(template)}>Save template</button></div>
            </article>
          ))}
        </div>
      </section>
      {toast ? <div className={`toast toast-strong ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>{toast.message}</div> : null}
    </main>
  )
}
