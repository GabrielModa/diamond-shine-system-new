import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { ensureEvidenceStorageReady } from '../../../lib/evidence-storage'
import { assessProductionReadiness } from '../../../lib/production-readiness'

export const dynamic = 'force-dynamic'

function releaseId() {
  return process.env.GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown'
}

export async function GET() {
  const timestamp = new Date().toISOString()
  const configuration = assessProductionReadiness()
  if (!configuration.ready) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Production configuration is not ready',
        data: {
          status: 'not_ready',
          release: releaseId(),
          configuration: configuration.checks.map(({ key, ok, level, message }) => ({ key, ok, level, message })),
          timestamp,
        },
      },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } }
    )
  }

  try {
    await Promise.all([prisma.$queryRaw`SELECT 1`, ensureEvidenceStorageReady()])
    return NextResponse.json(
      {
        ok: true,
        data: {
          status: 'ready',
          release: releaseId(),
          database: 'available',
          evidenceStorage: 'available',
          configuration: configuration.strict ? 'validated' : 'development',
          timestamp,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Service unavailable', data: { status: 'not_ready', release: releaseId(), timestamp } },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } }
    )
  }
}
