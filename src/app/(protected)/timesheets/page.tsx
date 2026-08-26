import TimesheetsWorkspace from '../../../components/timesheets/TimesheetsWorkspace'
import { currentUserCan } from '../../../lib/server-access'

export default async function TimesheetsPage() {
  return <TimesheetsWorkspace canManage={await currentUserCan('time.team.review')} />
}
