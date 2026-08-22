import { cookies } from 'next/headers'
import { sessionCookie, verifySessionToken } from '../../../lib/session'
import OperationalInbox from '../../../components/communications/OperationalInbox'

export default async function CommunicationsPage() {
  const session = await verifySessionToken((await cookies()).get(sessionCookie.name)?.value)
  return <OperationalInbox canManage={session?.role === 'admin' || session?.role === 'supervisor'} canConfigure={session?.role === 'admin'} />
}
