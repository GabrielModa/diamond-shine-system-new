import ScheduleBoard from '../../../components/schedule/ScheduleBoard'
import { currentMembershipAccess } from '../../../lib/server-access'
import FindTimeDateInputGuard from './FindTimeDateInputGuard'
import '../../../components/schedule/ScheduleEditFeedback.css'

export default async function SchedulePage() {
  const access = await currentMembershipAccess()
  if (!access) return null
  return <><FindTimeDateInputGuard /><ScheduleBoard canManage={access.can('schedule.manage')} timezone={access.membership.organization.timezone} /></>
}
