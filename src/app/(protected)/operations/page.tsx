import { cookies } from 'next/headers'
import { sessionCookie, verifySessionToken } from '../../../lib/session'
import OperationsHub from '../../../components/operations/OperationsHub'

export default async function OperationsPage() {
  const session = await verifySessionToken((await cookies()).get(sessionCookie.name)?.value)
  return <OperationsHub canManage={session?.role === 'admin' || session?.role === 'supervisor'} />
}
