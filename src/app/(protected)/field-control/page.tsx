import FieldControlBoard from '../../../components/field-control/FieldControlBoard'
import { currentMembershipAccess } from '../../../lib/server-access'

export default async function FieldControlPage() {
  const access = await currentMembershipAccess()
  if (!access) return null
  return <FieldControlBoard timezone={access.membership.organization.timezone} />
}
