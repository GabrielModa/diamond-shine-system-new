'use client'

import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogFocus(active: boolean) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active) return
    const previous = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    const animationFrame = requestAnimationFrame(() => (focusables()[0] ?? dialog)?.focus())

    function trapFocus(event: KeyboardEvent) {
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) {
        event.preventDefault()
        dialog?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', trapFocus)
    return () => {
      cancelAnimationFrame(animationFrame)
      document.removeEventListener('keydown', trapFocus)
      previous?.focus()
    }
  }, [active])

  return dialogRef
}
