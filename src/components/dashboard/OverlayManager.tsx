'use client'

import { ReactNode, useEffect, useMemo, useRef, useState } from 'react'

export type OverlayType = 'list' | 'detail' | 'email' | 'confirm'

export type OverlayApi = {
  stack: OverlayType[]
  open: (type: OverlayType) => void
  closeTop: (source?: 'popstate' | 'esc' | 'outside' | 'ui') => void
  closeAll: () => void
  isOpen: (type: OverlayType) => boolean
  isTop: (type: OverlayType) => boolean
}

type OverlayManagerProps = {
  children: (api: OverlayApi) => ReactNode
}

export function OverlayManager({ children }: OverlayManagerProps) {
  const [stack, setStack] = useState<OverlayType[]>([])
  const ignoreNextPop = useRef(false)

  const api = useMemo<OverlayApi>(() => {
    const isOpen = (type: OverlayType) => stack.includes(type)
    const isTop = (type: OverlayType) => stack[stack.length - 1] === type

    const open = (type: OverlayType) => {
      setStack((prev) => {
        if (prev[prev.length - 1] === type) return prev
        return [...prev, type]
      })
      window.history.pushState({ overlay: type }, '')
    }

    const closeTop = (source: 'popstate' | 'esc' | 'outside' | 'ui' = 'ui') => {
      setStack((prev) => (prev.length ? prev.slice(0, -1) : prev))
      if (source !== 'popstate') {
        ignoreNextPop.current = true
        window.history.back()
      }
    }

    const closeAll = () => {
      setStack([])
    }

    return { stack, open, closeTop, closeAll, isOpen, isTop }
  }, [stack])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && stack.length) {
        api.closeTop('esc')
      }
    }

    function onPopState() {
      if (ignoreNextPop.current) {
        ignoreNextPop.current = false
        return
      }
      if (stack.length) {
        api.closeTop('popstate')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('popstate', onPopState)
    }
  }, [api, stack.length])

  return <>{children(api)}</>
}
