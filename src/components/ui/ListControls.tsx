'use client'

import { useEffect, useId, useState } from 'react'
import StandardSelect from './StandardSelect'

type Props = {
  query: string
  onQueryChange: (value: string) => void
  from?: string
  to?: string
  onFromChange?: (value: string) => void
  onToChange?: (value: string) => void
  placeholder?: string
  label?: string
  onClear?: () => void
  hasActiveFilters?: boolean
  options?: Array<{
    label: string
    value: string
    defaultValue?: string
    choices: Array<{ value: string; label: string }>
    onChange: (value: string) => void
  }>
  hideSearch?: boolean
}

/** Shared, deliberately compact filtering pattern for dense operational lists. */
export default function ListControls({
  query,
  onQueryChange,
  from,
  to,
  onFromChange,
  onToChange,
  placeholder = 'Search this list…',
  label = 'Filter results',
  onClear,
  hasActiveFilters: hasActiveFiltersOverride,
  options = [],
  hideSearch = false,
}: Props) {
  const hasDates = onFromChange && onToChange
  const hasActiveFilters = hasActiveFiltersOverride ?? Boolean(query.trim() || from || to)
  const [open, setOpen] = useState(false)
  const [draftQuery, setDraftQuery] = useState(query)
  const [draftFrom, setDraftFrom] = useState(from ?? '')
  const [draftTo, setDraftTo] = useState(to ?? '')
  const [clearRequested, setClearRequested] = useState(false)
  const [draftOptions, setDraftOptions] = useState<Record<string, string>>({})
  const titleId = useId()

  function openFilters() {
    setDraftQuery(query)
    setDraftFrom(from ?? '')
    setDraftTo(to ?? '')
    setClearRequested(false)
    setDraftOptions(Object.fromEntries(options.map((option) => [option.label, option.value])))
    setOpen(true)
  }

  function dismiss() {
    setOpen(false)
    setClearRequested(false)
  }

  function clearDraft() {
    setDraftQuery('')
    setDraftFrom('')
    setDraftTo('')
    setClearRequested(true)
    setDraftOptions(Object.fromEntries(options.map((option) => [option.label, option.defaultValue ?? option.choices[0]?.value ?? ''])))
  }

  function apply() {
    if (clearRequested && onClear) onClear()
    else {
      onQueryChange(draftQuery)
      onFromChange?.(draftFrom)
      onToChange?.(draftTo)
      options.forEach((option) => option.onChange(draftOptions[option.label] ?? option.value))
    }
    setOpen(false)
    setClearRequested(false)
  }

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      dismiss()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  return <div className="list-filter-control">
    <button type="button" className={hasActiveFilters ? 'btn-primary list-filter-trigger' : 'btn-secondary list-filter-trigger'} aria-haspopup="dialog" aria-expanded={open} onClick={openFilters}>
      Filters{hasActiveFilters ? ' · Active' : ''}
    </button>
    {open ? <div className="filter-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss() }}>
      <section className="filter-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header><h2 id={titleId}>Filters</h2><button type="button" className="filter-dialog-close" aria-label="Discard filter changes" onClick={dismiss}>×</button></header>
        <div className="filter-dialog-body" role="search" aria-label={label}>
          {!hideSearch ? <label className="filter-dialog-search"><span>Search</span><input autoFocus type="search" value={draftQuery} onChange={(event) => { setDraftQuery(event.target.value); setClearRequested(false) }} placeholder={placeholder} /></label> : null}
          {hasDates ? <div className="filter-dialog-dates">
            <label><span>From</span><input type="date" value={draftFrom} onChange={(event) => { setDraftFrom(event.target.value); setClearRequested(false) }} /></label>
            <label><span>To</span><input type="date" value={draftTo} onChange={(event) => { setDraftTo(event.target.value); setClearRequested(false) }} /></label>
          </div> : null}
          {options.length ? <div className="filter-dialog-options">{options.map((option) => <div className="filter-dialog-select-field" key={option.label}><span>{option.label}</span><StandardSelect value={draftOptions[option.label] ?? option.value} onChange={(value) => { setDraftOptions((current) => ({ ...current, [option.label]: value })); setClearRequested(false) }} ariaLabel={option.label} options={option.choices} /></div>)}</div> : null}
        </div>
        <footer><button type="button" className="text-button" onClick={clearDraft}>Clear</button><button type="button" className="btn-primary" onClick={apply}>Apply</button></footer>
      </section>
    </div> : null}
  </div>
}
