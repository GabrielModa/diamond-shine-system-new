'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupplyRequest } from '../../types'

const PRIORITY_STYLES: Record<
  SupplyRequest['priority'],
  { emoji: string; color: string; bg: string; label: string }
> = {
  urgent: { emoji: '🔴', color: '#dc3545', bg: '#fff5f5', label: 'URGENT' },
  normal: { emoji: '🟡', color: '#ffc107', bg: '#fffbeb', label: 'NORMAL' },
  low: { emoji: '🟢', color: '#28a745', bg: '#f0fff4', label: 'LOW' },
}

function buildEmailBody(request: SupplyRequest): string {
  const priority = PRIORITY_STYLES[request.priority]
  const notesRow = request.notes
    ? `<tr><td>Notes</td><td>${request.notes}</td></tr>`
    : ''
  const date = new Date(request.createdAt).toLocaleString('en-IE')
  const products = request.products.join(', ')

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea, #764ba2); color: white; padding: 30px 20px; text-align: center; border-radius: 12px 12px 0 0; }
    .header h1 { margin: 0; font-size: 2rem; }
    .priority-banner { padding: 20px; margin: 20px; border-radius: 10px; border-left: 4px solid ${priority.color}; background: ${priority.bg}; }
    .priority-banner h2 { margin: 0; color: ${priority.color}; font-size: 1.3rem; }
    .info-card { margin: 20px; background: #f8f9fa; border-radius: 10px; overflow: hidden; }
    .info-table { width: 100%; border-collapse: collapse; }
    .info-table td { padding: 12px 16px; border-bottom: 1px solid #e9ecef; }
    .info-table td:first-child { font-weight: 600; color: #495057; width: 140px; }
    .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #6c757d; font-size: 0.875rem; border-top: 1px solid #dee2e6; }
  </style>
</head>
<body>
  <div class="header"><h1>💎 Diamond Shine</h1><p>Supplies Management System</p></div>
  <div class="priority-banner">
    <h2>${priority.emoji} ${priority.label} PRIORITY — ID: ${request.id}</h2>
  </div>
  <div class="info-card">
    <table class="info-table">
      <tr><td>Employee</td><td><strong>${request.employeeName}</strong></td></tr>
      <tr><td>Location</td><td>${request.clientLocation}</td></tr>
      <tr><td>Products</td><td>${products}</td></tr>
      ${notesRow}
      <tr><td>Date/Time</td><td>${date}</td></tr>
    </table>
  </div>
  <div class="footer">Request ID: <b>${request.id}</b> | Diamond Shine Automated System</div>
</body>
</html>`
}

type EmailModalProps = {
  open: boolean
  request: SupplyRequest | null
  onClose: () => void
  onSend: (payload: { clientEmail: string; subject: string; htmlBody: string }) => Promise<void>
}

export function EmailModal({ open, request, onClose, onSend }: EmailModalProps) {
  const [clientEmail, setClientEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const priority = request ? PRIORITY_STYLES[request.priority] : null

  const defaults = useMemo(() => {
    if (!request) return { subject: '', body: '' }
    const label = PRIORITY_STYLES[request.priority]
    return {
      subject: `Diamond Shine Supplies: ${label.emoji} ${label.label} - ${request.employeeName}`,
      body: buildEmailBody(request),
    }
  }, [request])

  useEffect(() => {
    if (!open || !request) return
    setClientEmail('')
    setSubject(defaults.subject)
    setBody(defaults.body)
  }, [open, request, defaults])

  const displayedSubject = subject || defaults.subject
  const displayedBody = body || defaults.body

  return (
    <div
      id="emailModal"
      className={`modal-overlay${open ? ' active' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal-card modal-wide zoom-in">
        <div className="modal-header">
          <h3>📧 Send Email to Client</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {request ? (
          <div className="info-card">
            <div className="row">
              <div>
                <div className="muted">Employee</div>
                <div>{request.employeeName}</div>
              </div>
              <div>
                <div className="muted">Location</div>
                <div>{request.clientLocation}</div>
              </div>
              <div>
                <div className="muted">Products</div>
                <div>{request.products.join(', ')}</div>
              </div>
              <div>
                <div className="muted">Priority</div>
                <div>
                  {priority?.emoji} {priority?.label}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <label htmlFor="clientEmail" className="muted">
          Client Email
        </label>
        <input
          id="clientEmail"
          type="email"
          required
          value={clientEmail}
          onChange={(event) => setClientEmail(event.target.value)}
          placeholder="client@example.com"
        />

        <label htmlFor="emailSubject" className="muted">
          Subject
        </label>
        <input
          id="emailSubject"
          value={displayedSubject}
          onChange={(event) => setSubject(event.target.value)}
        />

        <label htmlFor="emailBody" className="muted">
          Message Body (HTML)
        </label>
        <textarea id="emailBody" value={displayedBody} onChange={(event) => setBody(event.target.value)} />

        <div className="info-box amber">
          Pro Tip: Use a client-specific address so delivery receipts can be tracked per location.
        </div>

        <div className="row">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onSend({ clientEmail, subject: displayedSubject, htmlBody: displayedBody })}
            disabled={!clientEmail || !displayedSubject || !displayedBody}
          >
            📤 Send Email
          </button>
        </div>
      </div>
    </div>
  )
}
