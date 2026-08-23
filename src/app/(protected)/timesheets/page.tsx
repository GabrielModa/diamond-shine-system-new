import TimesheetsWorkspace from '../../../components/timesheets/TimesheetsWorkspace'
import { cookies } from 'next/headers'
import { sessionCookie, verifySessionToken } from '../../../lib/session'

export default async function TimesheetsPage() {
  const session = await verifySessionToken((await cookies()).get(sessionCookie.name)?.value)
  return <TimesheetsWorkspace canManage={session?.role === 'admin' || session?.role === 'supervisor'} />
}
