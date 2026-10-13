import type { PersistedState } from '../../shared/types'

const ITERATIONS = 600000
const CONTEXT = new TextEncoder().encode('newsletter-password-history:v1')

export interface HistoryPasswordKey {
  key: CryptoKey
  salt: Uint8Array<ArrayBuffer>
}

function base64(value: Uint8Array<ArrayBuffer>): string {
  let binary = ''
  for (let index = 0; index < value.length; index += 8192)
    binary += String.fromCharCode(...value.subarray(index, index + 8192))
  return btoa(binary)
}

function bytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length > 30 * 1024 * 1024)
    throw new Error('Invalid encrypted history.')
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>
): Promise<HistoryPasswordKey> {
  const encoded = new TextEncoder().encode(password)
  const material = await crypto.subtle.importKey('raw', encoded, 'PBKDF2', false, ['deriveKey'])
  encoded.fill(0)
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  return { key, salt }
}

export async function createHistoryPassword(password: string): Promise<HistoryPasswordKey> {
  if (password.length < 12) throw new Error('Use a history password with at least 12 characters.')
  return derive(password, crypto.getRandomValues(new Uint8Array(32)))
}

export async function encryptPasswordHistory(
  state: PersistedState,
  context: HistoryPasswordKey
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(state))
  if (plaintext.length > 20 * 1024 * 1024) throw new Error('History is too large to save.')
  try {
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: CONTEXT, tagLength: 128 },
      context.key,
      plaintext
    )
    return JSON.stringify({
      version: 1,
      kdf: 'PBKDF2-SHA256',
      iterations: ITERATIONS,
      salt: base64(context.salt),
      iv: base64(iv),
      data: base64(new Uint8Array(encrypted))
    })
  } finally {
    plaintext.fill(0)
  }
}

export async function unlockPasswordHistory(
  value: string,
  password: string
): Promise<{ state: PersistedState; context: HistoryPasswordKey }> {
  const envelope = JSON.parse(value)
  if (
    envelope.version !== 1 ||
    envelope.kdf !== 'PBKDF2-SHA256' ||
    envelope.iterations !== ITERATIONS
  )
    throw new Error('Invalid encrypted history.')
  const salt = bytes(envelope.salt)
  const iv = bytes(envelope.iv)
  const data = bytes(envelope.data)
  if (salt.length !== 32 || iv.length !== 12 || data.length < 16)
    throw new Error('Invalid encrypted history.')
  const context = await derive(password, salt)
  const decrypted = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: CONTEXT, tagLength: 128 },
      context.key,
      data
    )
  )
  try {
    const state: unknown = JSON.parse(new TextDecoder().decode(decrypted))
    if (!state || typeof state !== 'object' || !Array.isArray((state as PersistedState).candidates))
      throw new Error('Invalid saved history.')
    return { state: state as PersistedState, context }
  } finally {
    decrypted.fill(0)
  }
}
