export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({
    gitSha: process.env.DIAMOND_BUILD_SHA ?? 'unknown',
    buildTimestamp: process.env.DIAMOND_BUILD_TIME ?? null,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown',
    appVersion: process.env.DIAMOND_APP_VERSION ?? 'unknown',
  }, { headers: { 'Cache-Control': 'no-store' } })
}
