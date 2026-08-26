import OperationsHub from '../../../components/operations/OperationsHub'
import { currentUserCan } from '../../../lib/server-access'

export default async function OperationsPage() {
  const canManage = await currentUserCan('service_plans.manage') || await currentUserCan('sites.manage')
  return <OperationsHub canManage={canManage} />
}
