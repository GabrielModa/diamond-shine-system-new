'use client'

import { useEffect, useRef } from 'react'

type ConfirmModalProps = {
  open: boolean
  message: string
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmModal({ open, message, onConfirm, onClose }: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => previous?.focus()
  }, [open])

  return (
    <div
      id="confirmModal"
      className={`modal-overlay${open ? ' active' : ''}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      aria-hidden={!open}
    >
      <div className="modal-card zoom-in" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirmMessage">
        <h3 id="confirm-title">Confirm Action</h3>
        <p id="confirmMessage" className="muted">
          {message}
        </p>
        <div className="row">
          <button ref={cancelRef} type="button" className="btn-secondary" onClick={onClose}>
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
