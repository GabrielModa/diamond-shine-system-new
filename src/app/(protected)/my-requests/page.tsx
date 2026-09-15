import MaterialsWorkspace from '../../../components/materials/MaterialsWorkspace'
import { currentMembershipAccess } from '../../../lib/server-access'

export default async function MyRequestsPage() {
  const access = await currentMembershipAccess()
  if (!access) return null

  return <MaterialsWorkspace canManage={access.can('supplies.manage')} personalView />
}
