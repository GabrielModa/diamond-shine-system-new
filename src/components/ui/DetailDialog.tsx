'use client'

import { ReactNode, useEffect, useId, useRef } from 'react'

type DetailDialogProps = {
  open: boolean
  title: string
  eyebrow?: string
  onClose: () => void
  children: ReactNode
}

/**
 * Shared detail pattern for record lists. Keeping the detail in a dialog means
 * selecting a row never moves the list or forces the operator to scroll back
 * to where they were working.
 */
export default function DetailDialog({ open, title, eyebrow, onClose, children }: DetailDialogProps) {
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.setTimeout(() => closeButtonRef.current?.focus(), 0)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [open])

  if (!open) return null

  return (
    <div className="detail-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="detail-dialog-header">
          <div>
            {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="detail-dialog-close" aria-label={`Close ${title}`} onClick={onClose}>×</button>
        </header>
        <div className="detail-dialog-body">{children}</div>
      </section>
    </div>
  )
}
