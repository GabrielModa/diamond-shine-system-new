'use client'

import { createPortal } from 'react-dom'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'

export type StandardSelectOption = {
  value: string
  label: string
  description?: string
  meta?: string
  disabled?: boolean
}

type StandardSelectProps = {
  value: string
  options: StandardSelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel: string
  searchable?: boolean
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
}

type MenuPosition = {
  left: number
  top: number
  width: number
  maxHeight: number
  placement: 'above' | 'below'
}

export default function StandardSelect({
  value,
  options,
  onChange,
  placeholder = 'Select an option',
  ariaLabel,
  searchable,
  searchPlaceholder = 'Search…',
  emptyText = 'No matching options.',
  disabled = false,
  className = '',
}: StandardSelectProps) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const selected = options.find((option) => option.value === value) ?? null
  const hasSearch = searchable ?? options.length > 8
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) => `${option.label} ${option.description ?? ''} ${option.meta ?? ''}`.toLowerCase().includes(needle))
  }, [options, query])

  function openMenu() {
    if (disabled) return
    setQuery('')
    setOpen(true)
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled))
  }

  function closeMenu(restoreFocus = false) {
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  function choose(option: StandardSelectOption) {
    if (option.disabled) return
    onChange(option.value)
    closeMenu(true)
  }

  function moveActive(direction: 1 | -1, currentOptions = filtered) {
    if (!currentOptions.length) return
    const currentValue = activeIndex >= 0 ? currentOptions[activeIndex]?.value : value
    let index = Math.max(0, currentOptions.findIndex((option) => option.value === currentValue))
    for (let attempts = 0; attempts < currentOptions.length; attempts += 1) {
      index = (index + direction + currentOptions.length) % currentOptions.length
      if (!currentOptions[index]?.disabled) {
        setActiveIndex(index)
        return
      }
    }
  }

  function triggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) openMenu()
      else moveActive(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Escape' && open) {
      event.preventDefault()
      closeMenu(true)
    }
  }

  function searchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Enter' && activeIndex >= 0 && filtered[activeIndex]) {
      event.preventDefault()
      choose(filtered[activeIndex])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu(true)
    }
  }

  useEffect(() => {
    if (!open) {
      setMenuPosition(null)
      return
    }

    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const edge = 12
      const gap = 7
      const desiredHeight = hasSearch ? 360 : 320
      const minimumUsefulHeight = 150
      const below = Math.max(0, window.innerHeight - rect.bottom - edge - gap)
      const above = Math.max(0, rect.top - edge - gap)
      const placement: MenuPosition['placement'] = below >= minimumUsefulHeight || below >= above ? 'below' : 'above'
      const available = placement === 'below' ? below : above
      const width = Math.min(Math.max(rect.width, 220), Math.max(0, window.innerWidth - edge * 2))
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
    const focusTimer = hasSearch ? window.setTimeout(() => searchRef.current?.focus(), 0) : null
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      if (focusTimer != null) window.clearTimeout(focusTimer)
    }
  }, [hasSearch, open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeMenu(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMenu(true)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const firstEnabled = filtered.findIndex((option) => !option.disabled)
    const selectedIndex = filtered.findIndex((option) => option.value === value && !option.disabled)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled)
  }, [filtered, open, value])

  const menu = open && menuPosition ? <div
    ref={menuRef}
    id={listId}
    role="listbox"
    aria-label={ariaLabel}
    className={`standard-select-menu ${menuPosition.placement}`}
    style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width, maxHeight: menuPosition.maxHeight }}
  >
    {hasSearch ? <div className="standard-select-search"><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={searchKeyDown} placeholder={searchPlaceholder} aria-label={`Search ${ariaLabel.toLowerCase()}`} /></div> : null}
    <div className="standard-select-options">
      {filtered.length ? filtered.map((option, index) => <button
        key={option.value}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={option.value === value}
        disabled={option.disabled}
        className={`${index === activeIndex ? 'active' : ''} ${option.value === value ? 'selected' : ''}`.trim()}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => { if (!option.disabled) setActiveIndex(index) }}
        onClick={() => choose(option)}
      >
        <span className="standard-select-option-copy"><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
        <span className="standard-select-option-side">{option.meta ? <em>{option.meta}</em> : option.value === value ? <b aria-label="Selected">✓</b> : null}</span>
      </button>) : <p className="standard-select-empty">{emptyText}</p>}
    </div>
  </div> : null

  return <div ref={rootRef} className={`standard-select ${className}`.trim()}>
    <button
      ref={triggerRef}
      type="button"
      className="standard-select-trigger"
      role="combobox"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      disabled={disabled}
      onClick={() => open ? closeMenu(false) : openMenu()}
      onKeyDown={triggerKeyDown}
    >
      <span className="standard-select-trigger-copy">
        <strong className={selected ? '' : 'placeholder'}>{selected?.label ?? placeholder}</strong>
        {selected?.description ? <small>{selected.description}</small> : null}
      </span>
      <span className="standard-select-chevron" aria-hidden="true">⌄</span>
    </button>
    {typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : null}

    <style jsx global>{`
      .standard-select{position:relative;min-width:0;width:100%}
      .standard-select-trigger{width:100%;min-height:46px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 13px;border:1px solid #d8dbe6;border-radius:12px;background:#fff;color:#17182b;text-align:left;box-shadow:none;font:inherit}
      .standard-select-trigger:hover{border-color:#c7c9d5;background:#fff}
      .standard-select-trigger:focus-visible,.standard-select[data-open='true'] .standard-select-trigger{outline:2px solid rgba(102,126,234,.38);outline-offset:1px;border-color:rgba(102,126,234,.82)}
      .standard-select-trigger-copy{display:grid;gap:2px;min-width:0;flex:1}
      .standard-select-trigger-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.94rem;font-weight:750;color:#17182b}
      .standard-select-trigger-copy strong.placeholder{color:#697083;font-weight:700}
      .standard-select-trigger-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7c8093;font-size:.76rem;font-weight:600}
      .standard-select-chevron{flex:0 0 auto;color:#5f6678;font-size:1rem;font-weight:800;line-height:1}
      .standard-select-menu{position:fixed;z-index:10050;display:flex;flex-direction:column;overflow:hidden;border:1px solid #d8dbe6;border-radius:15px;background:#fff;box-shadow:0 24px 60px rgba(15,23,42,.2)}
      .standard-select-menu.above{transform:translateY(-100%)}
      .standard-select-search{flex:0 0 auto;padding:10px;border-bottom:1px solid #eceef4;background:#fafafe}
      .standard-select-search input{width:100%;min-height:42px;padding:9px 11px;border:1px solid #d8dbe6;border-radius:10px;background:#fff;font:inherit}
      .standard-select-search input:focus{outline:2px solid rgba(102,126,234,.3);border-color:rgba(102,126,234,.8)}
      .standard-select-options{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:5px}
      .standard-select-options>button{width:100%;display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:48px;padding:10px 11px;border:0;border-radius:10px;background:#fff;color:#17182b;text-align:left;box-shadow:none}
      .standard-select-options>button:hover,.standard-select-options>button.active{background:#f4f2ff;outline:0}
      .standard-select-options>button.selected{background:#f7f6ff}
      .standard-select-options>button:disabled{opacity:.45;cursor:not-allowed}
      .standard-select-option-copy{display:grid;gap:2px;min-width:0}
      .standard-select-option-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.9rem;font-style:normal;font-weight:750}
      .standard-select-option-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#747b8e;font-size:.75rem;font-weight:550}
      .standard-select-option-side{flex:0 0 auto;display:flex;align-items:center;color:#6659d5}
      .standard-select-option-side em{color:#747b8e;font-size:.78rem;font-style:normal;font-weight:700;white-space:nowrap}
      .standard-select-option-side b{font-size:.82rem}
      .standard-select-empty{margin:0;padding:15px;color:#7c8093;font-size:.82rem}
      @media(max-width:640px){.standard-select-menu{border-radius:13px}.standard-select-options>button{padding:11px}}
    `}</style>
  </div>
}
