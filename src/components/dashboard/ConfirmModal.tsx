'use client'

type ConfirmModalProps = {
  open: boolean
  message: string
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmModal({ open, message, onConfirm, onClose }: ConfirmModalProps) {
  return (
    <div
      id="confirmModal"
      className={`modal-overlay${open ? ' active' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal-card zoom-in">
        <h3>Confirm Action</h3>
        <p id="confirmMessage" className="muted">
          {message}
        </p>
        <div className="row">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
