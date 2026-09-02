import ClientAccount from '../../../../components/clients/ClientAccount'
import { currentUserCan } from '../../../../lib/server-access'

export default async function ClientAccountPage() {
  const canManageClients = await currentUserCan('clients.manage')
  const canConfigureService = canManageClients
    && await currentUserCan('sites.manage')
    && await currentUserCan('service_plans.manage')
    && await currentUserCan('schedule.manage')
  return <ClientAccount canManageClients={canManageClients} canConfigureService={canConfigureService} />
}
