import { PrismaClient } from '@prisma/client'

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
}

function normalizeStatus(value: unknown): unknown {
  if (value === 'Email Sent') return 'EmailSent'
  return value
}

function normalizeCategory(value: unknown): unknown {
  if (value === 'Very Good') return 'VeryGood'
  return value
}

function normalizeData(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data

  if (Array.isArray(data)) {
    return data.map((item) => normalizeData(item))
  }

  const record = data as Record<string, unknown>
  const normalized: Record<string, unknown> = { ...record }

  if ('status' in normalized) {
    normalized.status = normalizeStatus(normalized.status)
  }

  if ('category' in normalized) {
    normalized.category = normalizeCategory(normalized.category)
  }

  return normalized
}

export const prisma = global.prisma ?? new PrismaClient()

type MiddlewareFn = (
  params: { action: string; args?: Record<string, unknown> },
  next: (params: { action: string; args?: Record<string, unknown> }) => Promise<unknown>
) => Promise<unknown>

const useFn = (prisma as unknown as { $use?: (cb: MiddlewareFn) => void }).$use
if (typeof useFn === 'function') {
  useFn.call(prisma, async (params, next) => {
    const operation = params.action

    if (
      operation === 'create' ||
      operation === 'createMany' ||
      operation === 'update' ||
      operation === 'updateMany' ||
      operation === 'upsert'
    ) {
      if (params.args && 'data' in params.args) {
        params.args.data = normalizeData(params.args.data)
      }

      if (operation === 'upsert' && params.args) {
        if ('create' in params.args) {
          params.args.create = normalizeData(params.args.create)
        }
        if ('update' in params.args) {
          params.args.update = normalizeData(params.args.update)
        }
      }
    }

    return next(params)
  })
}

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma
}
