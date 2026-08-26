import ScheduleBoard from '../../../components/schedule/ScheduleBoard'
import { currentUserCan } from '../../../lib/server-access'

export default async function SchedulePage() {
  return <ScheduleBoard canManage={await currentUserCan('schedule.manage')} />
}
