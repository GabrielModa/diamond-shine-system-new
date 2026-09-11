import ClientAccountWorkspace from '../../../../components/clients/ClientAccountWorkspace'
import { currentMembershipAccess } from '../../../../lib/server-access'

export default async function ClientAccountPage() {
  const access = await currentMembershipAccess()
  const canManageClients = access?.can('clients.manage') ?? false
  const canConfigureService = Boolean(
    canManageClients
    && access?.can('sites.manage')
    && access?.can('service_plans.manage')
    && access?.can('schedule.manage')
  )
  return <ClientAccountWorkspace canManageClients={canManageClients} canConfigureService={canConfigureService} />
}
