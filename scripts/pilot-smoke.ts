import { assessPilotReadiness } from '../src/lib/pilot-readiness'

type LoginBody = { ok?: boolean; error?: string; data?: { accessToken?: string; role?: string } }

const readiness = assessPilotReadiness(process.env)
for (const check of readiness.checks) console.log(`${check.ok ? '✓' : '✗'} ${check.key}: ${check.message}`)
if (!readiness.ready) {
  console.error('Pilot smoke configuration is not ready. Credential values were not printed.')
  process.exit(1)
}

const base = new URL(process.env.NEXTAUTH_URL as string).origin
const admin = { email: process.env.PILOT_ADMIN_EMAIL as string, password: process.env.PILOT_ADMIN_PASSWORD as string }
const employee = { email: process.env.PILOT_EMPLOYEE_EMAIL as string, password: process.env.PILOT_EMPLOYEE_PASSWORD as string }

function requireCookieSecurity(header: string) {
  if (!/HttpOnly/i.test(header)) throw new Error('Session cookie is missing HttpOnly.')
  if (!/SameSite=Lax/i.test(header)) throw new Error('Session cookie is missing SameSite=Lax.')
  if (base.startsWith('https://') && !/Secure/i.test(header)) throw new Error('Production session cookie is missing Secure.')
}

async function loginWeb(label: string, credentials: { email: string; password: string }) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(credentials),
    redirect: 'manual',
  })
  const body = await response.json().catch(() => null) as LoginBody | null
  if (response.status !== 200 || !body?.ok) throw new Error(`${label} web login failed with HTTP ${response.status}: ${body?.error ?? 'unknown error'}`)
  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error(`${label} login did not set a session cookie.`)
  requireCookieSecurity(setCookie)
  const cookie = setCookie.split(';', 1)[0]
  console.log(`✓ ${label} web login`)
  return cookie
}

async function authenticatedJson(path: string, headers: Record<string, string>) {
  const response = await fetch(`${base}${path}`, { headers: { Accept: 'application/json', ...headers }, redirect: 'manual' })
  const body = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
  if (response.status !== 200 || !body?.ok) throw new Error(`${path} returned HTTP ${response.status}: ${body?.error ?? 'unknown error'}`)
  return body
}

async function logoutWeb(cookie: string) {
  const response = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie }, redirect: 'manual' })
  if (response.status !== 303) throw new Error(`Web logout returned HTTP ${response.status}`)
}

async function mobileEmployeeSmoke() {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...employee, mobile: true, deviceName: 'V13 launch smoke' }),
  })
  const body = await response.json().catch(() => null) as LoginBody | null
  const token = body?.data?.accessToken
  if (response.status !== 200 || !body?.ok || !token) throw new Error(`Employee mobile login failed with HTTP ${response.status}`)
  await authenticatedJson('/api/operational-notices?scope=mine', { Authorization: `Bearer ${token}` })
  const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  if (logout.status !== 200) throw new Error(`Mobile logout returned HTTP ${logout.status}`)
  console.log('✓ employee mobile bearer session + inbox + revocation')
}

try {
  const adminCookie = await loginWeb('admin', admin)
  await authenticatedJson('/api/clients', { Cookie: adminCookie })
  console.log('✓ admin operational API access')
  await logoutWeb(adminCookie)

  const employeeCookie = await loginWeb('employee', employee)
  const now = Date.now()
  const from = new Date(now - 86_400_000).toISOString()
  const to = new Date(now + 7 * 86_400_000).toISOString()
  await authenticatedJson(`/api/visits?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { Cookie: employeeCookie })
  console.log('✓ employee assigned-work API access')
  await logoutWeb(employeeCookie)

  await mobileEmployeeSmoke()
  console.log('Pilot role smoke passed. No operational records were created or edited.')
} catch (error) {
  console.error(`Pilot smoke failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
