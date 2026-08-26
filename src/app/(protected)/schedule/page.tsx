import ScheduleBoard from '../../../components/schedule/ScheduleBoard'
import { currentMembershipAccess } from '../../../lib/server-access'

export default async function SchedulePage() {
  const access = await currentMembershipAccess()
  if (!access) return null
  return <ScheduleBoard canManage={access.can('schedule.manage')} timezone={access.membership.organization.timezone} />
}
