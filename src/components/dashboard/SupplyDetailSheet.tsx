'use client'

import type { SupplyRequest, SupplyStatus } from '../../types'
import { getSupplyNextStatuses, isSupplyOverdue } from '../../lib/business-logic'
import { useDialogFocus } from './useDialogFocus'

type SupplyDetailSheetProps = {
  open: boolean
  active: boolean
  request: SupplyRequest | null
  onClose: () => void
  onSendEmail: () => void
  onTransition: (status: SupplyStatus) => void
  assignees: Array<{ email: string; name: string | null }>
  onAssign: (email: string | null) => Promise<void>
}

export function SupplyDetailSheet({
  open,
  active,
  request,
  onClose,
  onSendEmail,
  onTransition,
  assignees,
  onAssign,
}: SupplyDetailSheetProps) {
  const dialogRef = useDialogFocus(active)
  if (!request) return null
  const overdue = isSupplyOverdue(request.dueAt, request.status)

  return (
    <div
      id="detailOverlay"
      className={`overlay${open ? ' active' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      aria-hidden={!active}
    >
      <div ref={dialogRef} tabIndex={-1} className="overlay-sheet detail-sheet fade-up" role="dialog" aria-modal="true" aria-labelledby="supply-detail-title">
        <div className="sheet-header">
          <h2 id="supply-detail-title">
            <span className="title-icon">📦</span>
            Supply Request
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-subtitle">Review request details and actions</div>

        <div className="detail-grid" data-testid="supply-detail">
          <div className="detail-item">
            <div className="detail-label">Request ID</div>
            <div className="detail-value">{request.id}</div>
          </div>
          <div className="detail-item">
            <label className="detail-label" htmlFor="supplyAssignee">Responsible</label>
            <select
              id="supplyAssignee"
              value={request.assignedTo ?? ''}
              disabled={request.status === 'Delivered' || request.status === 'Rejected' || request.status === 'Cancelled'}
              onChange={(event) => void onAssign(event.target.value || null)}
            >
              <option value="">Unassigned</option>
              {assignees.map((assignee) => <option key={assignee.email} value={assignee.email}>{assignee.name ?? assignee.email}</option>)}
            </select>
          </div>
          <div className="detail-item">
            <div className="detail-label">SLA due</div>
            <div className={`detail-value${overdue ? ' overdue-text' : ''}`}>{request.dueAt ? new Date(request.dueAt).toLocaleString('en-IE') : 'Not set'}{overdue ? ' · Overdue' : ''}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Employee</div>
            <div className="detail-value">{request.employeeName}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Location</div>
            <div className="detail-value">{request.clientLocation}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Priority</div>
            <div className={`detail-value badge ${request.priority}`}>
              {request.priority === 'urgent' ? '🔴' : request.priority === 'normal' ? '🟡' : '🟢'}{' '}
              {request.priority}
            </div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Status</div>
            <div className={`detail-value status-badge ${request.status.replace(' ', '-')}`}>{request.status}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Products</div>
            <div className="detail-value">{(request.items?.length ? request.items : request.products.map((product) => ({ product, quantity: 1 }))).map((item) => `${item.product} × ${item.quantity}`).join(', ')}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Date</div>
            <div className="detail-value">{new Date(request.createdAt).toLocaleString('en-IE')}</div>
          </div>
          <div className="detail-item">
            <div className="detail-label">Submitted by</div>
            <div className="detail-value">{request.submittedBy}</div>
          </div>
          {request.notes ? (
            <div className="detail-item">
              <div className="detail-label">Notes</div>
              <div className="detail-value">{request.notes}</div>
            </div>
          ) : null}
        </div>

        <section className="status-history" aria-labelledby="status-history-title">
          <h3 id="status-history-title">Status history</h3>
          {(request.history?.length ? request.history : [{
            id: `${request.id}-created`,
            fromStatus: null,
            toStatus: 'Requested' as const,
            actorEmail: request.submittedBy,
            note: 'Request submitted',
            createdAt: request.createdAt,
          }]).map((event) => (
            <div key={event.id} className="status-history-event">
              <span className="history-dot" />
              <div>
                <strong>{event.toStatus}</strong>
                <div className="muted">{event.note || `Changed from ${event.fromStatus ?? 'start'}`}</div>
                <div className="muted">{event.actorEmail} · {new Date(event.createdAt).toLocaleString('en-IE')}</div>
              </div>
            </div>
          ))}
        </section>

        <div className="row action-row">
          {!['Delivered', 'Rejected', 'Cancelled'].includes(request.status) ? (
            <button type="button" className="btn-success" onClick={onSendEmail}>📧 Notify client</button>
          ) : null}
          {getSupplyNextStatuses(request.status).map((status) => (
            <button
              key={status}
              type="button"
              className={status === 'Rejected' || status === 'Cancelled' ? 'btn-warning' : 'btn-info'}
              onClick={() => onTransition(status)}
            >
              {status === 'Delivered' ? '✅' : status === 'Rejected' || status === 'Cancelled' ? '⛔' : '→'} {status}
            </button>
          ))}
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
