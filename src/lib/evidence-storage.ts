import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type EvidenceMimeType = keyof typeof MIME_EXTENSIONS
export type EvidenceStorageProvider = 'filesystem' | 'supabase'

function present(value: string | undefined) {
  return Boolean(value?.trim())
}

export function evidenceStorageProvider(env: NodeJS.ProcessEnv = process.env): EvidenceStorageProvider {
  const configured = env.EVIDENCE_STORAGE_PROVIDER?.trim().toLowerCase()
  if (configured === 'filesystem' || configured === 'supabase') return configured
  if (env.NODE_ENV === 'production') throw new Error('Production evidence storage requires EVIDENCE_STORAGE_PROVIDER')
  return 'filesystem'
}

function storageRoot(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.EVIDENCE_STORAGE_ROOT?.trim()
  if (env.NODE_ENV === 'production') {
    if (!configured) throw new Error('Filesystem evidence storage requires EVIDENCE_STORAGE_ROOT')
    if (!path.isAbsolute(configured)) throw new Error('EVIDENCE_STORAGE_ROOT must be an absolute persistent path in production')
  }
  return path.resolve(/* turbopackIgnore: true */ configured || path.join(process.cwd(), '.data', 'uploads'))
}

function normalizedStorageKey(storageKey: string) {
  const value = storageKey.trim()
  if (!value || value.startsWith('/') || value.includes('\\')) throw new Error('Invalid evidence storage key')
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new Error('Invalid evidence storage key')
  return segments.join('/')
}

function storagePath(storageKey: string) {
  const root = storageRoot()
  const destination = path.resolve(root, normalizedStorageKey(storageKey))
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error('Invalid evidence storage key')
  return destination
}

function supabaseStorageConfig(env: NodeJS.ProcessEnv = process.env) {
  const rawUrl = env.SUPABASE_URL?.trim() ?? ''
  const secretKey = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
  const bucket = env.SUPABASE_EVIDENCE_BUCKET?.trim() ?? ''

  let origin = ''
  try {
    const url = new URL(rawUrl)
    if (env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Supabase URL must use HTTPS in production')
    origin = url.origin
  } catch {
    throw new Error('Supabase evidence storage requires a valid SUPABASE_URL')
  }
  if (!present(secretKey)) throw new Error('Supabase evidence storage requires SUPABASE_SECRET_KEY')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(bucket)) throw new Error('Supabase evidence storage requires a valid SUPABASE_EVIDENCE_BUCKET')

  return { origin, secretKey, bucket }
}

function encodedObjectPath(storageKey: string) {
  return normalizedStorageKey(storageKey).split('/').map(encodeURIComponent).join('/')
}

async function supabaseStorageFetch(pathname: string, init: RequestInit = {}) {
  const { origin, secretKey } = supabaseStorageConfig()
  const headers = new Headers(init.headers)
  headers.set('apikey', secretKey)
  headers.set('Authorization', `Bearer ${secretKey}`)
  return fetch(`${origin}/storage/v1/${pathname}`, { ...init, headers, cache: 'no-store' })
}

export async function ensureEvidenceStorageReady() {
  if (evidenceStorageProvider() === 'filesystem') {
    await mkdir(storageRoot(), { recursive: true })
    return
  }

  const { bucket } = supabaseStorageConfig()
  const response = await supabaseStorageFetch(`bucket/${encodeURIComponent(bucket)}`)
  if (!response.ok) throw new Error(`Supabase evidence bucket is unavailable (${response.status})`)
  const details = await response.json().catch(() => null) as { public?: boolean } | null
  if (details?.public === true) throw new Error('Supabase evidence bucket must be private')
}

export function detectEvidenceMimeType(bytes: Uint8Array): EvidenceMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return 'image/png'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export async function storeEvidence(input: {
  organizationId: string
  visitId: string
  bytes: Uint8Array
  declaredMimeType: string
}) {
  const detectedMimeType = detectEvidenceMimeType(input.bytes)
  if (!detectedMimeType || detectedMimeType !== input.declaredMimeType) {
    throw new Error('The uploaded file contents do not match a supported image type.')
  }

  const fileName = `${Date.now()}-${crypto.randomUUID()}.${MIME_EXTENSIONS[detectedMimeType]}`
  const storageKey = path.posix.join('evidence', input.organizationId, input.visitId, fileName)

  if (evidenceStorageProvider() === 'supabase') {
    const { bucket } = supabaseStorageConfig()
    const response = await supabaseStorageFetch(`object/${encodeURIComponent(bucket)}/${encodedObjectPath(storageKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': detectedMimeType,
        'x-upsert': 'false',
      },
      body: input.bytes,
    })
    if (!response.ok) throw new Error(`Supabase evidence upload failed (${response.status})`)
  } else {
    const destination = storagePath(storageKey)
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, input.bytes)
  }

  return { storageKey, fileName, mimeType: detectedMimeType }
}

export async function readEvidence(storageKey: string) {
  if (evidenceStorageProvider() === 'supabase') {
    const { bucket } = supabaseStorageConfig()
    const response = await supabaseStorageFetch(`object/authenticated/${encodeURIComponent(bucket)}/${encodedObjectPath(storageKey)}`)
    if (!response.ok) throw new Error(`Supabase evidence read failed (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  }
  return readFile(/* turbopackIgnore: true */ storagePath(storageKey))
}

export async function removeEvidence(storageKey: string) {
  if (evidenceStorageProvider() === 'supabase') {
    const { bucket } = supabaseStorageConfig()
    const response = await supabaseStorageFetch(`object/${encodeURIComponent(bucket)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [normalizedStorageKey(storageKey)] }),
    })
    if (!response.ok && response.status !== 404) throw new Error(`Supabase evidence removal failed (${response.status})`)
    return
  }

  await unlink(storagePath(storageKey)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}

export function safeDownloadName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'evidence'
}
