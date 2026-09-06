'use client'

import { forwardRef } from 'react'
import styles from './SurfaceCloseButton.module.css'

type SurfaceCloseButtonProps = {
  onClick: () => void
  label?: string
  className?: string
}

const SurfaceCloseButton = forwardRef<HTMLButtonElement, SurfaceCloseButtonProps>(function SurfaceCloseButton(
  { onClick, label = 'Close', className = '' },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`${styles.close} ${className}`.trim()}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <span aria-hidden="true">×</span>
    </button>
  )
})

export default SurfaceCloseButton
