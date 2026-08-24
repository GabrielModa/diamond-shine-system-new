import { PRODUCTS } from '../../lib/constants'
import { prisma } from '../../lib/prisma'

function skuFor(name: string) {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function categoryFor(name: string) {
  const normalized = name.toLowerCase()
  if (normalized.includes('paper') || normalized.includes('bag')) return 'Consumables'
  if (normalized.includes('glove') || normalized.includes('cloth')) return 'PPE & tools'
  return 'Chemicals'
}

export async function ensureDefaultMaterialCatalog(organizationId: string) {
  await Promise.all(PRODUCTS.map((product) => prisma.materialCatalogItem.upsert({
    where: { organizationId_sku: { organizationId, sku: skuFor(product.value) } },
    update: {},
    create: {
      organizationId,
      sku: skuFor(product.value),
      name: product.value,
      category: categoryFor(product.value),
      unit: 'unit',
      defaultParLevel: 10,
      defaultReorderPoint: 3,
    },
  })))
}

export function materialState(input: { onHand: number; reorderPoint: number; parLevel: number }) {
  if (input.onHand <= 0) return 'out' as const
  if (input.onHand <= input.reorderPoint) return 'reorder' as const
  if (input.onHand < input.parLevel) return 'low' as const
  return 'healthy' as const
}
