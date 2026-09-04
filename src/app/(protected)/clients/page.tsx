import ClientsWorkspace from '../../../components/clients/ClientsWorkspace'
import { currentUserCan } from '../../../lib/server-access'

export default async function ClientsPage() {
  const canManageClients = await currentUserCan('clients.manage')
  return <ClientsWorkspace canManageClients={canManageClients} />
}
