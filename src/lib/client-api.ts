type ApiEnvelope<T> = {
  ok?: boolean
  data?: T
  error?: string
}

export async function clientApi<T>(url: string, options?: RequestInit, fallback = 'Request failed'): Promise<T> {
  const response = await fetch(url, { credentials: 'include', cache: 'no-store', ...options })
  const raw = await response.text()
  let body: ApiEnvelope<T> | null = null

  if (raw) {
    try {
      body = JSON.parse(raw) as ApiEnvelope<T>
    } catch {
      body = null
    }
  }

  if (!response.ok || !body?.ok || !Object.prototype.hasOwnProperty.call(body, 'data')) {
    if (body?.error) throw new Error(body.error)
    if (!raw) throw new Error(`${fallback} (HTTP ${response.status}: empty response).`)
    throw new Error(`${fallback} (HTTP ${response.status}: invalid server response).`)
  }

  return body.data as T
}
