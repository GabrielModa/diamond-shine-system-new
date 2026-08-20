import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const timestamp = new Date().toISOString()
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json(
      { ok: true, data: { status: 'ready', database: 'available', timestamp } },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Service unavailable', data: { status: 'not_ready', database: 'unavailable', timestamp } },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } }
    )
  }
}
