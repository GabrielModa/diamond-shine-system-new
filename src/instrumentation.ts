import { type Instrumentation } from 'next'

function releaseId() {
  return process.env.GIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown'
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const digest = typeof error === 'object' && error !== null && 'digest' in error
    ? String((error as { digest?: unknown }).digest ?? '')
    : ''
  const name = error instanceof Error ? error.name : 'UnknownError'

  console.error(JSON.stringify({
    event: 'server_request_error',
    name,
    digest: digest || undefined,
    method: request.method,
    path: request.path.split('?')[0],
    route: context.routePath,
    routeType: context.routeType,
    release: releaseId(),
    timestamp: new Date().toISOString(),
  }))
}
