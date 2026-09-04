import ClientAccountWorkspace from '../../../../components/clients/ClientAccountWorkspace'
import { currentUserCan } from '../../../../lib/server-access'

export default async function ClientAccountPage() {
  const canManageClients = await currentUserCan('clients.manage')
  const canConfigureService = canManageClients
    && await currentUserCan('sites.manage')
    && await currentUserCan('service_plans.manage')
    && await currentUserCan('schedule.manage')
  return <ClientAccountWorkspace canManageClients={canManageClients} canConfigureService={canConfigureService} />
}
