import MaterialsWorkspace from '../../../components/materials/MaterialsWorkspace'
import { currentUserCan } from '../../../lib/server-access'

export default async function SuppliesPage() {
  return <MaterialsWorkspace canManage={await currentUserCan('supplies.manage')} />
}
