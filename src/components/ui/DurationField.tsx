'use client'

type Props = {
  label?: string
  value: number
  onChange: (minutes: number) => void
  minMinutes?: number
  maxHours?: number
}

export default function DurationField({ label = 'Duration', value, onChange, minMinutes = 15, maxHours = 24 }: Props) {
  const safeValue = Math.max(minMinutes, Math.round(value || minMinutes))
  const hours = Math.floor(safeValue / 60)
  const minutes = safeValue % 60
  const baseMinutes = Array.from({ length: 12 }, (_, index) => index * 5)
  const minuteOptions = [...new Set([...baseMinutes, minutes])].sort((a, b) => a - b)

  function update(nextHours: number, nextMinutes: number) {
    onChange(Math.max(minMinutes, Math.min(maxHours * 60, nextHours * 60 + nextMinutes)))
  }

  return <fieldset className="duration-field">
    <legend>{label}</legend>
    <div className="duration-field-controls">
      <label><span>Hours</span><input type="number" min="0" max={maxHours} inputMode="numeric" value={hours} onChange={(event) => update(Math.max(0, Number(event.target.value) || 0), minutes)} /></label>
      <label><span>Minutes</span><select value={minutes} onChange={(event) => update(hours, Number(event.target.value))}>{minuteOptions.map((minute) => <option value={minute} key={minute}>{String(minute).padStart(2, '0')}</option>)}</select></label>
    </div>
  </fieldset>
}
