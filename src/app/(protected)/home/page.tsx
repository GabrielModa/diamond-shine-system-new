import ManagerOverview from '../../../components/manager/ManagerOverview'
import RoleWorkspaceHome from '../../../components/home/RoleWorkspaceHome'
import { currentMembershipAccess } from '../../../lib/server-access'

const labels: Record<string, string> = {
  organization_admin: 'Organization admin', field_supervisor: 'Field supervisor', scheduler: 'Scheduler', employee: 'Cleaner / employee', stock_controller: 'Stock controller', quality_inspector: 'Quality inspector', finance: 'Finance', viewer: 'Viewer',
}
export default async function HomePage() {
  const access = await currentMembershipAccess()
  if (!access) return null
  if (access.can('schedule.manage') || access.can('visits.review')) return <ManagerOverview />
  return <RoleWorkspaceHome roleLabel={labels[access.membership.role] ?? access.membership.role} canSchedule={access.can('schedule.read')} canSupplies={access.can('supplies.request')} canQuality={access.can('quality.inspect')} canTimeReview={access.can('time.team.review')} canFinance={access.can('finance.read')} />
}
