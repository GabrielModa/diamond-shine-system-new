'use client'

import { useEffect } from 'react'

const HEALTH_AFFECTING_SUCCESS = [
  'Visit updated and the assigned team has been notified.',
  'Visit cancelled, removed from Operational',
  'Visit scheduled.',
]

export default function ScheduleHealthMutationSync() {
  useEffect(() => {
    const syncSuccessfulMutations = () => {
      document.querySelectorAll<HTMLElement>('.toast.success:not([data-health-synced])').forEach((toast) => {
        const text = toast.textContent ?? ''
        if (!HEALTH_AFFECTING_SUCCESS.some((message) => text.includes(message))) return

        toast.dataset.healthSynced = 'true'
        window.setTimeout(() => {
          const refreshButton = Array.from(document.querySelectorAll<HTMLButtonElement>('.schedule-health-panel button'))
            .find((button) => button.textContent?.includes('Refresh health'))
          if (refreshButton && !refreshButton.disabled) refreshButton.click()
        }, 0)
      })
    }

    syncSuccessfulMutations()
    const observer = new MutationObserver(syncSuccessfulMutations)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return null
}
