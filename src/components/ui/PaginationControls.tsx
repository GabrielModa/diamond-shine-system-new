'use client'

type Props = {
  page: number
  totalPages: number
  total: number
  limit: number
  onPageChange: (page: number) => void
  loading?: boolean
  noun?: string
  className?: string
}

export default function PaginationControls({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  loading = false,
  noun = 'results',
  className = '',
}: Props) {
  if (total <= 0) return null

  const safeTotalPages = Math.max(1, totalPages)
  const safePage = Math.min(Math.max(1, page), safeTotalPages)
  const start = (safePage - 1) * limit + 1
  const end = Math.min(safePage * limit, total)
  const label = total === 1 && noun.endsWith('s') ? noun.slice(0, -1) : noun

  return <nav className={`pagination-bar${className ? ` ${className}` : ''}`} aria-label={`${label} pages`}>
    <span className="pagination-summary">Showing <strong>{start}–{end}</strong> of <strong>{total}</strong> {label}</span>
    {safeTotalPages > 1 ? <div className="pagination-actions">
      <button type="button" className="btn-secondary" disabled={loading || safePage <= 1} onClick={() => onPageChange(safePage - 1)}>← Previous</button>
      <strong>Page {safePage} of {safeTotalPages}</strong>
      <button type="button" className="btn-secondary" disabled={loading || safePage >= safeTotalPages} onClick={() => onPageChange(safePage + 1)}>Next →</button>
    </div> : null}
  </nav>
}
