const base = (process.env.NEXTAUTH_URL || '').replace(/\/$/, '')
const secret = process.env.NOTIFICATION_WORKER_SECRET || ''
if (!base || !secret) {
  console.error('NEXTAUTH_URL and NOTIFICATION_WORKER_SECRET are required.')
  process.exit(1)
}
if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
  console.error('Notification worker refuses a non-HTTPS remote origin.')
  process.exit(1)
}

const limit = Math.min(250, Math.max(1, Number(process.env.NOTIFICATION_WORKER_LIMIT || 100)))
try {
  const response = await fetch(`${base}/api/internal/notifications/process?limit=${limit}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || !body?.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  console.log(`Notification worker: ${body.data.processed} processed, ${body.data.sent} sent, ${body.data.failed} failed.`)
} catch (error) {
  console.error(`Notification worker failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
