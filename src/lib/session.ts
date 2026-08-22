import type { UserRole } from '../types'
import { LEGACY_ORGANIZATION_ID } from './tenancy'

const SESSION_TTL_SECONDS = 60 * 60 * 12

type SessionPayload = {
  email: string
  role: UserRole
  organizationId: string
  exp: number
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required in production')
  }
  return 'diamond-shine-development-secret-change-me'
}

function encode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function decode(value: string): string {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  let binary = ''
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function isRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'supervisor' || value === 'employee' || value === 'viewer'
}

export async function createSessionToken(
  email: string,
  role: UserRole,
  organizationId = LEGACY_ORGANIZATION_ID
): Promise<string> {
  const payload = encode(
    JSON.stringify({
      email,
      role,
      organizationId,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    })
  )
  return `${payload}.${await sign(payload)}`
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return null

  const expected = await sign(payload)
  if (signature.length !== expected.length) return null

  let mismatch = 0
  for (let index = 0; index < signature.length; index += 1) {
    mismatch |= signature.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  if (mismatch !== 0) return null

  try {
    const parsed = JSON.parse(decode(payload)) as Partial<SessionPayload>
    if (typeof parsed.email !== 'string' || !isRole(parsed.role) || typeof parsed.exp !== 'number') return null
    if (parsed.exp <= Math.floor(Date.now() / 1000)) return null
    return {
      email: parsed.email,
      role: parsed.role,
      organizationId: typeof parsed.organizationId === 'string'
        ? parsed.organizationId
        : LEGACY_ORGANIZATION_ID,
      exp: parsed.exp,
    }
  } catch {
    return null
  }
}

export const sessionCookie = {
  name: 'ds-session',
  maxAge: SESSION_TTL_SECONDS,
} as const
