'use client'

import type { SupplyRequest } from '../../types'

type SupplyDetailSheetProps = {
  open: boolean
  request: SupplyRequest | null
  onClose: () => void
  onSendEmail: () => void
  onCompleteWithoutEmail: () => void
  onMarkCompleted: () => void
}

export function SupplyDetailSheet({
  open,
  request,
  onClose,
  onSendEmail,
  onCompleteWithoutEmail,
  onMarkCompleted,
}: SupplyDetailSheetProps) {
  if (!request) return null

  return (
    <div
      id="detailOverlay"
      className={`overlay${open ? ' active' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="overlay-sheet detail-sheet fade-up">
        <div className="sheet-header">
          <h2>
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
            <div className="detail-value">{request.products.join(', ')}</div>
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

        <div className="row action-row">
          {request.status === 'Pending' ? (
            <>
              <button type="button" className="btn-success" onClick={onSendEmail}>
                📧 Send Email to Client
              </button>
              <button type="button" className="btn-warning" onClick={onCompleteWithoutEmail}>
                ⚡ Complete Without Email
              </button>
            </>
          ) : null}
          {request.status === 'Email Sent' ? (
            <button type="button" className="btn-info" onClick={onMarkCompleted}>
              ✅ Mark as Completed
            </button>
          ) : null}
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
