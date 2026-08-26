import OperationalInbox from '../../../components/communications/OperationalInbox'
import { currentUserCan } from '../../../lib/server-access'

export default async function CommunicationsPage() {
  return <OperationalInbox canManage={await currentUserCan('communications.manage')} canConfigure={await currentUserCan('organization.manage')} />
}
