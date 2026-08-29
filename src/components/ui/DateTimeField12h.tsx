'use client'

import TimeField12h from './TimeField12h'
import styles from './DateTimeField12h.module.css'

function splitValue(value: string) {
  const [date = '', clock = '09:00'] = value.split('T')
  const [hour = 9, minute = 0] = clock.split(':').map(Number)
  const minutes = Number.isFinite(hour) && Number.isFinite(minute) ? Math.min(1439, Math.max(0, hour * 60 + minute)) : 540
  return { date, minutes }
}

function clockValue(minutes: number) {
  const normalized = Math.min(1439, Math.max(0, Math.round(minutes)))
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

export default function DateTimeField12h({
  label,
  value,
  onChange,
  required = false,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  disabled?: boolean
}) {
  const current = splitValue(value)

  return (
    <label className={styles.field}>
      <span>{label}</span>
      <div className={styles.control}>
        <input
          aria-label={`${label} date`}
          type="date"
          required={required}
          disabled={disabled}
          value={current.date}
          onChange={(event) => onChange(`${event.target.value}T${clockValue(current.minutes)}`)}
        />
        <TimeField12h
          ariaLabel={`${label} time`}
          disabled={disabled}
          value={current.minutes}
          onChange={(minutes) => onChange(`${current.date}T${clockValue(minutes)}`)}
        />
      </div>
    </label>
  )
}
