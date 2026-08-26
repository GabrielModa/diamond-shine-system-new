import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type EvidenceMimeType = keyof typeof MIME_EXTENSIONS

function storageRoot() {
  const configured = process.env.EVIDENCE_STORAGE_ROOT?.trim()
  if (process.env.NODE_ENV === 'production') {
    if (!configured) throw new Error('Production evidence storage requires EVIDENCE_STORAGE_ROOT')
    if (!path.isAbsolute(configured)) throw new Error('EVIDENCE_STORAGE_ROOT must be an absolute persistent path in production')
  }
  return path.resolve(/* turbopackIgnore: true */ configured || path.join(process.cwd(), '.data', 'uploads'))
}

export async function ensureEvidenceStorageReady() {
  await mkdir(storageRoot(), { recursive: true })
}

function storagePath(storageKey: string) {
  if (!storageKey || path.isAbsolute(storageKey)) throw new Error('Invalid evidence storage key')
  const root = storageRoot()
  const destination = path.resolve(root, storageKey)
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error('Invalid evidence storage key')
  return destination
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
  const destination = storagePath(storageKey)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, input.bytes)
  return { storageKey, fileName, mimeType: detectedMimeType }
}

export async function readEvidence(storageKey: string) {
  return readFile(/* turbopackIgnore: true */ storagePath(storageKey))
}

export async function removeEvidence(storageKey: string) {
  await unlink(storagePath(storageKey)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}

export function safeDownloadName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'evidence'
}
