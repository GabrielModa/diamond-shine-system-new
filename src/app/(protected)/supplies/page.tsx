import MaterialsWorkspace from '../../../components/materials/MaterialsWorkspace'
import { currentMembershipAccess } from '../../../lib/server-access'

export default async function SuppliesPage() {
  const access = await currentMembershipAccess()
  if (!access) return null
  const canManage = access.can('supplies.manage')
  const operationsDeskHref = ['organization_admin', 'field_supervisor'].includes(access.membership.role) ? '/dashboard' : null
  return <MaterialsWorkspace canManage={canManage} operationsDeskHref={operationsDeskHref} />
}
