export function formatDuration(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes))
  const hours = Math.floor(safeMinutes / 60)
  const remainder = safeMinutes % 60

  if (!hours) return `${remainder} min`
  if (!remainder) return `${hours} h`
  return `${hours} h ${remainder} min`
}
