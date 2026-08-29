'use client'

import styles from './TimeField12h.module.css'

const HOURS = Array.from({ length: 12 }, (_, index) => index + 1)
const BASE_MINUTES = Array.from({ length: 12 }, (_, index) => index * 5)

function normalizeMinuteOfDay(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(1439, Math.max(0, Math.round(value)))
}

export default function TimeField12h({
  value,
  onChange,
  ariaLabel = 'Time',
  disabled = false,
}: {
  value: number
  onChange: (value: number) => void
  ariaLabel?: string
  disabled?: boolean
}) {
  const normalized = normalizeMinuteOfDay(value)
  const hour24 = Math.floor(normalized / 60)
  const minute = normalized % 60
  const hour12 = hour24 % 12 || 12
  const period: 'am' | 'pm' = hour24 >= 12 ? 'pm' : 'am'
  const minuteOptions = BASE_MINUTES.includes(minute) ? BASE_MINUTES : [...BASE_MINUTES, minute].sort((a, b) => a - b)

  function update(nextHour12: number, nextMinute: number, nextPeriod: 'am' | 'pm') {
    let nextHour24 = nextHour12 % 12
    if (nextPeriod === 'pm') nextHour24 += 12
    onChange(nextHour24 * 60 + nextMinute)
  }

  return (
    <div className={styles.time} aria-label={ariaLabel}>
      <select aria-label={`${ariaLabel} hour`} value={hour12} disabled={disabled} onChange={(event) => update(Number(event.target.value), minute, period)}>
        {HOURS.map((hour) => <option key={hour} value={hour}>{hour}</option>)}
      </select>
      <span aria-hidden="true">:</span>
      <select aria-label={`${ariaLabel} minute`} value={minute} disabled={disabled} onChange={(event) => update(hour12, Number(event.target.value), period)}>
        {minuteOptions.map((item) => <option key={item} value={item}>{String(item).padStart(2, '0')}</option>)}
      </select>
      <select aria-label={`${ariaLabel} am or pm`} value={period} disabled={disabled} onChange={(event) => update(hour12, minute, event.target.value as 'am' | 'pm')}>
        <option value="am">am</option>
        <option value="pm">pm</option>
      </select>
    </div>
  )
}
