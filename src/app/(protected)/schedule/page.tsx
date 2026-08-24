import { cookies } from 'next/headers'
import ScheduleBoard from '../../../components/schedule/ScheduleBoard'
import { sessionCookie, verifySessionToken } from '../../../lib/session'

export default async function SchedulePage() {
  const session = await verifySessionToken((await cookies()).get(sessionCookie.name)?.value)
  return <ScheduleBoard canManage={session?.role === 'admin' || session?.role === 'supervisor'} />
}
