'use client'

import OpsIcon from './OpsIcon'
import styles from './PaginationControls.module.css'

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

  return <nav className={`pagination-bar ${styles.bar}${className ? ` ${className}` : ''}`} aria-label={`${label} pages`}>
    <span className={`pagination-summary ${styles.summary}`}>Showing <strong>{start}–{end}</strong> of <strong>{total}</strong> {label}</span>
    {safeTotalPages > 1 ? <div className={`pagination-actions ${styles.actions}`}>
      <button type="button" className={`btn-secondary ${styles.navButton}`} aria-label="Previous page" disabled={loading || safePage <= 1} onClick={() => onPageChange(safePage - 1)}><OpsIcon name="chevronLeft" size={15} /><span>Previous</span></button>
      <span className={styles.pageChip} aria-current="page"><strong>{safePage}</strong><span>of {safeTotalPages}</span></span>
      <button type="button" className={`btn-secondary ${styles.navButton}`} aria-label="Next page" disabled={loading || safePage >= safeTotalPages} onClick={() => onPageChange(safePage + 1)}><span>Next</span><OpsIcon name="chevronRight" size={15} /></button>
    </div> : null}
  </nav>
}
