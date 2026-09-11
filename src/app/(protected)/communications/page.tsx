import OperationalInbox from '../../../components/communications/OperationalInbox'
import { currentMembershipAccess } from '../../../lib/server-access'

export default async function CommunicationsPage() {
  const access = await currentMembershipAccess()
  return <OperationalInbox
    canManage={access?.can('communications.manage') ?? false}
    canConfigure={access?.can('organization.manage') ?? false}
  />
}
