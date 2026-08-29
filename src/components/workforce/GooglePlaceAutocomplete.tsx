
'use client'

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

export type PlaceSelection = {
  placeId: string
  displayName: string | null
  formattedAddress: string
  latitude: number
  longitude: number
  types: string[]
}

type Suggestion = {
  placeId: string
  text: string
  mainText: string
  secondaryText: string
  types: string[]
}

type Props = {
  kind: 'home' | 'school'
  label: string
  value: string
  placeholder: string
  selected: PlaceSelection | null
  onValueChange: (value: string) => void
  onSelect: (place: PlaceSelection) => void
  setupToken?: string
  helpText?: string
}

type MenuPosition = {
  left: number
  top: number
  width: number
  maxHeight: number
  placement: 'above' | 'below'
}

function sessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function GooglePlaceAutocomplete({
  kind,
  label,
  value,
  placeholder,
  selected,
  onValueChange,
  onSelect,
  setupToken,
  helpText,
}: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const sessionToken = useRef(sessionId())
  const selectedText = useMemo(
    () => selected ? (kind === 'school' ? selected.displayName ?? selected.formattedAddress : selected.formattedAddress) : '',
    [kind, selected],
  )

  useEffect(() => {
    const input = value.trim()
    if (selected && input === selectedText) {
      setSuggestions([])
      setOpen(false)
      setError('')
      return
    }
    if (input.length < 3) {
      setSuggestions([])
      setOpen(false)
      setLoading(false)
      setError('')
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError('')
      void fetch('/api/places/autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(setupToken ? { 'x-invite-setup-token': setupToken } : {}),
        },
        body: JSON.stringify({ input, kind, sessionToken: sessionToken.current }),
        signal: controller.signal,
      }).then(async (response) => {
        const body = await response.json().catch(() => null) as { ok?: boolean; error?: string; data?: Suggestion[] } | null
        if (!response.ok || !body?.ok) throw new Error(body?.error ?? 'Could not search Google Maps.')
        const next = body.data ?? []
        setSuggestions(next)
        setOpen(true)
        setActiveIndex(next.length ? 0 : -1)
      }).catch((caught) => {
        if (controller.signal.aborted) return
        setSuggestions([])
        setOpen(true)
        setError(caught instanceof Error ? caught.message : 'Could not search Google Maps.')
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    }, 280)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [kind, selected, selectedText, setupToken, value])

  useEffect(() => {
    if (!open) {
      setMenuPosition(null)
      return
    }

    const updatePosition = () => {
      const input = inputRef.current
      if (!input) return
      const rect = input.getBoundingClientRect()
      const edge = 12
      const gap = 6
      const desiredHeight = 320
      const minimumUsefulHeight = 150
      const below = Math.max(0, window.innerHeight - rect.bottom - edge - gap)
      const above = Math.max(0, rect.top - edge - gap)
      const placement: MenuPosition['placement'] = below >= minimumUsefulHeight || below >= above ? 'below' : 'above'
      const available = placement === 'below' ? below : above
      const width = Math.min(rect.width, Math.max(0, window.innerWidth - edge * 2))
      const left = Math.min(Math.max(edge, rect.left), Math.max(edge, window.innerWidth - edge - width))

      setMenuPosition({
        left,
        top: placement === 'below' ? rect.bottom + gap : rect.top - gap,
        width,
        maxHeight: Math.max(120, Math.min(desiredHeight, available)),
        placement,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [error, loading, open, suggestions.length])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  async function choose(suggestion: Suggestion) {
    setResolving(true)
    setError('')
    try {
      const response = await fetch('/api/places/resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(setupToken ? { 'x-invite-setup-token': setupToken } : {}),
        },
        body: JSON.stringify({
          placeId: suggestion.placeId,
          kind,
          sessionToken: sessionToken.current,
        }),
      })
      const body = await response.json().catch(() => null) as { ok?: boolean; error?: string; data?: PlaceSelection } | null
      if (!response.ok || !body?.ok || !body.data) throw new Error(body?.error ?? 'Could not verify the selected Google Maps place.')
      onSelect(body.data)
      setSuggestions([])
      setOpen(false)
      setActiveIndex(-1)
      sessionToken.current = sessionId()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not verify the selected Google Maps place.')
      setOpen(true)
    } finally {
      setResolving(false)
    }
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || !suggestions.length) {
      if (event.key === 'ArrowDown' && suggestions.length) setOpen(true)
      if (event.key === 'Escape') setOpen(false)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => Math.min(suggestions.length - 1, current + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => Math.max(0, current - 1))
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      void choose(suggestions[activeIndex])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const floatingMenu = open && menuPosition ? <div
    ref={menuRef}
    className={`google-place-floating-menu ${menuPosition.placement}`}
    id={listId}
    role="listbox"
    style={{
      left: menuPosition.left,
      top: menuPosition.top,
      width: menuPosition.width,
      maxHeight: menuPosition.maxHeight,
    }}
  >
    <div className="google-place-options">
      {loading ? <div className="google-place-empty">Searching Google Maps…</div> : null}
      {!loading && suggestions.map((suggestion, index) => <button
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={index === activeIndex}
        id={`${listId}-${index}`}
        key={suggestion.placeId}
        className={index === activeIndex ? 'active' : ''}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => void choose(suggestion)}
      >
        <span><strong>{suggestion.mainText}</strong>{suggestion.secondaryText ? <small>{suggestion.secondaryText}</small> : null}</span>
        <span aria-hidden="true">›</span>
      </button>)}
      {!loading && !suggestions.length && !error ? <div className="google-place-empty">No matching places. Add more of the address.</div> : null}
      {error ? <div className="google-place-error" role="alert">{error}</div> : null}
    </div>
    <div className="google-place-attribution" translate="no">Google Maps</div>
  </div> : null

  return <div className="google-place-field" ref={rootRef}>
    <label htmlFor={`${listId}-input`}><span>{label}</span></label>
    <div className="google-place-combobox">
      <input
        ref={inputRef}
        id={`${listId}-input`}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        onChange={(event) => {
          onValueChange(event.target.value)
          setOpen(true)
          setError('')
        }}
        onFocus={() => {
          if (suggestions.length || error) setOpen(true)
        }}
        onKeyDown={keyDown}
      />
      <span className={`google-place-state ${selected ? 'verified' : loading || resolving ? 'loading' : ''}`} aria-live="polite">
        {resolving ? 'Verifying…' : loading ? 'Searching…' : selected ? '✓ Selected' : ''}
      </span>
    </div>
    {selected ? <small className="google-place-verified"><strong>✓ Verified with Google Maps</strong><span>{selected.formattedAddress}</span></small> : <small className="muted">{helpText ?? 'Start typing, then choose the correct result from Google Maps.'}</small>}
    {typeof document !== 'undefined' && floatingMenu ? createPortal(floatingMenu, document.body) : null}

    <style jsx>{`
      .google-place-field { position: relative; display: grid; gap: 6px; min-width: 0; }
      .google-place-field label { display: grid; gap: 6px; font-size: .85rem; color: #4b5563; }
      .google-place-combobox { position: relative; }
      .google-place-combobox input { width: 100%; padding-right: 104px; }
      .google-place-state { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-size: .72rem; font-weight: 800; color: #64748b; pointer-events: none; }
      .google-place-state.verified { color: #047857; }
      .google-place-state.loading { color: #6d28d9; }
      .google-place-verified { display: grid; gap: 1px; color: #047857; }
      .google-place-verified strong { font-weight: 800; }
      .google-place-verified span { color: #52605b; font-weight: 600; }
    `}</style>
    <style jsx global>{`
      .google-place-floating-menu { position: fixed; z-index: 10000; display: flex; flex-direction: column; overflow: hidden; border: 1px solid #d8dbe6; border-radius: 14px; background: white; box-shadow: 0 22px 55px rgba(15, 23, 42, .22); }
      .google-place-floating-menu.above { transform: translateY(-100%); }
      .google-place-floating-menu .google-place-options { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
      .google-place-floating-menu button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 0; border-radius: 0; padding: 12px 14px; text-align: left; background: white; }
      .google-place-floating-menu button + button { border-top: 1px solid #eef0f5; }
      .google-place-floating-menu button:hover, .google-place-floating-menu button.active { background: #f7f5ff; outline: 0; }
      .google-place-floating-menu button span:first-child { min-width: 0; display: grid; gap: 2px; }
      .google-place-floating-menu button strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #111827; }
      .google-place-floating-menu button small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #6b7280; }
      .google-place-floating-menu .google-place-empty, .google-place-floating-menu .google-place-error { padding: 12px 14px; font-size: .82rem; color: #64748b; }
      .google-place-floating-menu .google-place-error { color: #b91c1c; background: #fff7f7; }
      .google-place-floating-menu .google-place-attribution { flex: 0 0 auto; padding: 7px 14px 8px; border-top: 1px solid #eef0f5; background: white; color: #5e5e5e; font-family: Arial, sans-serif; font-size: 12px; font-style: normal; font-weight: 400; line-height: 1.2; text-align: right; }
      @media (max-width: 640px) {
        .google-place-floating-menu { border-radius: 12px; }
        .google-place-floating-menu button { padding: 13px 12px; }
      }
    `}</style>
  </div>
}
