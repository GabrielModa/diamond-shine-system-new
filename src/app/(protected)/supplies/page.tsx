import { cookies } from 'next/headers'
import { sessionCookie, verifySessionToken } from '../../../lib/session'
import MaterialsWorkspace from '../../../components/materials/MaterialsWorkspace'

export default async function SuppliesPage() {
  const session = await verifySessionToken((await cookies()).get(sessionCookie.name)?.value)
  return <MaterialsWorkspace canManage={session?.role === 'admin' || session?.role === 'supervisor'} />
}
