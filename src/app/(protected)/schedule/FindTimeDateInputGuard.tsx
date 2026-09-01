'use client'

import { useEffect } from 'react'

function isFinderDateInput(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement
    && target.type === 'date'
    && Boolean(target.closest('.find-time'))
}

export default function FindTimeDateInputGuard() {
  useEffect(() => {
    const rememberValidDate = (event: Event) => {
      if (!isFinderDateInput(event.target)) return
      const input = event.target

      if (input.value) {
        input.dataset.lastValidDate = input.value
        return
      }

      // Native date inputs briefly emit an empty value while a user edits a
      // segment with Backspace. Keep React's last valid finder date until the
      // browser has a complete date again, so availability calculations never
      // receive an invalid date.
      event.stopPropagation()
    }

    const rememberOnFocus = (event: FocusEvent) => {
      if (!isFinderDateInput(event.target)) return
      if (event.target.value) event.target.dataset.lastValidDate = event.target.value
    }

    const restoreIfLeftEmpty = (event: FocusEvent) => {
      if (!isFinderDateInput(event.target)) return
      const input = event.target
      if (!input.value && input.dataset.lastValidDate) input.value = input.dataset.lastValidDate
    }

    document.addEventListener('input', rememberValidDate, true)
    document.addEventListener('change', rememberValidDate, true)
    document.addEventListener('focusin', rememberOnFocus, true)
    document.addEventListener('focusout', restoreIfLeftEmpty, true)

    return () => {
      document.removeEventListener('input', rememberValidDate, true)
      document.removeEventListener('change', rememberValidDate, true)
      document.removeEventListener('focusin', rememberOnFocus, true)
      document.removeEventListener('focusout', restoreIfLeftEmpty, true)
    }
  }, [])

  return null
}
