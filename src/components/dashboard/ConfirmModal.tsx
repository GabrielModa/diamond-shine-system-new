'use client'

import { useDialogFocus } from './useDialogFocus'

type ConfirmModalProps = {
  open: boolean
  active: boolean
  message: string
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmModal({ open, active, message, onConfirm, onClose }: ConfirmModalProps) {
  const dialogRef = useDialogFocus(active, onClose)

  return (
    <div
      id="confirmModal"
      className={`modal-overlay${open ? ' active' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      aria-hidden={!active}
    >
      <div ref={dialogRef} tabIndex={-1} className="modal-card zoom-in" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirmMessage">
        <h3 id="confirm-title">Confirm Action</h3>
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
