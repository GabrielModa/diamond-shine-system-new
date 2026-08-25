'use client'

import { ReactNode, useEffect, useId, useRef } from 'react'

type DetailDialogProps = {
  open: boolean
  title: string
  eyebrow?: string
  onClose: () => void
  children: ReactNode
}

export default function DetailDialog({ open, title, eyebrow, onClose, children }: DetailDialogProps) {
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.setTimeout(() => closeButtonRef.current?.focus(), 0)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.setTimeout(() => previousFocusRef.current?.focus(), 0)
    }
  }, [onClose, open])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [open])

  if (!open) return null

  return (
    <div
      className="detail-dialog-backdrop"
      role="presentation"
      data-testid="detail-dialog-backdrop"
      onClick={onClose}
    >
      <section
        className="detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
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
