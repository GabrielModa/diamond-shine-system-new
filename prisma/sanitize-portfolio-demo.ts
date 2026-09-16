import { PrismaClient } from '@prisma/client'
import { assertDemoSeedAllowed } from '../src/lib/demo-seed-guard'
import { LEGACY_ORGANIZATION_ID } from '../src/lib/tenancy'

assertDemoSeedAllowed()
const prisma = new PrismaClient()

const CLIENT_RENAMES: Array<[string, string]> = [
  ['Age Action', 'Orchid Community Services'],
  ['EPAM Systems (Ireland) Ltd', 'Novus Technology Group'],
  ['Darren Cahill', 'Cedar Lane Property'],
  ['St. Finian’s Lutheran Church', 'Willow Community Trust'],
  ["St. Finian's Lutheran Church", 'Willow Community Trust'],
  ['Sandyford Operations Centre', 'Summit Operations Group'],
  ['Harbour Retail Group', 'Oak & Finch Retail'],
  ['Docklands Media Studio', 'Northlight Media'],
  ['TechCorp Ireland', 'Aster & Co'],
  ['Green Bank', 'Willow Financial'],
  ['Harbourview Legal', 'Cedarstone Legal'],
  ['Liffey Media', 'Northlight Media'],
  ['Rathmines Health', 'Everwell Health'],
]

const SITE_RENAMES: Array<[string, string]> = [
  ['Camden Street Lower', 'Orchid House'],
  ['EPAM Systems Ireland', 'Innovation House'],
  ['Grattan House', 'Cedar House'],
  ['Adelaide Road', 'Willow Hall'],
  ['Beacon Quarter Office', 'Summit Quarter Office'],
  ['Grafton Street Store', 'Central Store'],
  ['Grand Canal Dock Studio', 'Studio Two'],
  ['Grand Canal Office', 'Quayside Offices'],
  ['Temple Bar Branch', 'Copper Lane Branch'],
  ['Docklands Suite', 'Harbour Suite'],
  ['Smithfield Studio', 'Studio One'],
  ['Wellness Centre', 'Wellness Hub'],
]

async function main() {
  let renamedClients = 0
  let renamedSites = 0
  let rewrittenHistory = 0

  for (const [from, to] of CLIENT_RENAMES) {
    const result = await prisma.client.updateMany({
      where: { organizationId: LEGACY_ORGANIZATION_ID, displayName: from },
      data: { displayName: to, legalName: `${to} Demo Ltd` },
    })
    renamedClients += result.count
  }

  for (const [from, to] of SITE_RENAMES) {
    const result = await prisma.site.updateMany({
      where: { organizationId: LEGACY_ORGANIZATION_ID, name: from },
      data: { name: to },
    })
    renamedSites += result.count

    const [supplies, feedback] = await Promise.all([
      prisma.supplyRequest.updateMany({
        where: { organizationId: LEGACY_ORGANIZATION_ID, clientLocation: from },
        data: { clientLocation: to },
      }),
      prisma.feedbackEntry.updateMany({
        where: { organizationId: LEGACY_ORGANIZATION_ID, clientLocation: from },
        data: { clientLocation: to },
      }),
    ])
    rewrittenHistory += supplies.count + feedback.count
  }

  console.log(
    `Portfolio demo sanitised: ${renamedClients} client name(s), ${renamedSites} site name(s), ${rewrittenHistory} historical location label(s) updated.`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
