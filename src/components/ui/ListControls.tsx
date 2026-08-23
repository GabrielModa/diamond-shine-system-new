'use client'

type Props = {
  query: string
  onQueryChange: (value: string) => void
  from?: string
  to?: string
  onFromChange?: (value: string) => void
  onToChange?: (value: string) => void
  placeholder?: string
  label?: string
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
}: Props) {
  const hasDates = onFromChange && onToChange
  return <div className="list-controls" role="search" aria-label={label}>
    <label className="list-search-field">
      <span aria-hidden="true">⌕</span>
      <span className="sr-only">{placeholder}</span>
      <input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={placeholder} />
    </label>
    {hasDates ? <div className="list-date-range">
      <label><span>From</span><input type="date" value={from} onChange={(event) => onFromChange(event.target.value)} /></label>
      <label><span>To</span><input type="date" value={to} onChange={(event) => onToChange(event.target.value)} /></label>
    </div> : null}
  </div>
}
