import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'
import { ensureEvidenceStorageReady } from '../../../lib/evidence-storage'

export const dynamic = 'force-dynamic'

export async function GET() {
  const timestamp = new Date().toISOString()
  try {
    await Promise.all([prisma.$queryRaw`SELECT 1`, ensureEvidenceStorageReady()])
    return NextResponse.json(
      { ok: true, data: { status: 'ready', database: 'available', evidenceStorage: 'available', timestamp } },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Service unavailable', data: { status: 'not_ready', timestamp } },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } }
    )
  }
}
