import OperationsHub from '../../../components/operations/OperationsHub'
import { currentMembershipAccess } from '../../../lib/server-access'

export default async function OperationsPage() {
  const access = await currentMembershipAccess()
  const canManage = Boolean(access?.can('service_plans.manage') || access?.can('sites.manage'))
  return <OperationsHub canManage={canManage} />
}
