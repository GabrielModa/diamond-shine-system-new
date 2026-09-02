import ScheduleBoard from '../../../components/schedule/ScheduleBoard'
import { Suspense } from 'react'
import { currentMembershipAccess } from '../../../lib/server-access'
import '../../../components/schedule/ScheduleEditFeedback.css'

export default async function SchedulePage() {
  const access = await currentMembershipAccess()
  if (!access) return null
  return <Suspense fallback={<p>Loading schedule…</p>}><ScheduleBoard canManage={access.can('schedule.manage')} timezone={access.membership.organization.timezone} /></Suspense>
}
