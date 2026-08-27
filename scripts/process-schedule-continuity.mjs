const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
const secret = process.env.NOTIFICATION_WORKER_SECRET || ''
if (!base || !secret) {
  console.error('NEXTAUTH_URL and NOTIFICATION_WORKER_SECRET are required.')
  process.exit(1)
}
if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
  console.error('Schedule continuity worker refuses a non-HTTPS remote origin.')
  process.exit(1)
}
const horizonDays = Math.min(365, Math.max(30, Number(process.env.SCHEDULE_CONTINUITY_HORIZON_DAYS || 120)))
try {
  const response = await fetch(`${base}/api/internal/schedule-continuity/process?horizonDays=${horizonDays}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  console.log(`Schedule continuity: ${body.data.organizations} organizations, ${body.data.jobsChecked} jobs, ${body.data.generatedVisits} visits generated, ${body.data.pausedOccurrences} paused obligations, ${body.data.staffingGaps} staffing gaps.`)
} catch (error) {
  console.error(`Schedule continuity worker failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
