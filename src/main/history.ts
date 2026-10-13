import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { secureStorageAvailable } from './secure-storage'
import { validateHistory } from './validation'
import type { HistoryLoadResult, HistoryStorageInfo, PersistedState } from '../shared/types'

let state: PersistedState = { candidates: [] }
let info: HistoryStorageInfo = { mode: 'session', locked: false, hasSavedHistory: false }
let loaded = false
let operations: Promise<unknown> = Promise.resolve()
const MAX_HISTORY_BYTES = 20 * 1024 * 1024
const FILE_CONTEXT = Buffer.from('newsletter-history:v1')

function encryptHistory(value: string): Buffer {
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(FILE_CONTEXT)
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.from(
    JSON.stringify({
      version: 1,
      key: safeStorage.encryptString(key.toString('base64')).toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64')
    })
  )
}

function decryptHistory(value: Buffer): string {
  if (value.length > MAX_HISTORY_BYTES * 2) throw new Error('Invalid encrypted history.')
  const envelope = JSON.parse(value.toString('utf8'))
  if (
    envelope.version !== 1 ||
    !['key', 'iv', 'tag', 'data'].every((field) => typeof envelope[field] === 'string')
  )
    throw new Error('Invalid encrypted history.')
  const key = Buffer.from(safeStorage.decryptString(Buffer.from(envelope.key, 'base64')), 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  if (key.length !== 32 || iv.length !== 12 || tag.length !== 16)
    throw new Error('Invalid encrypted history.')
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(FILE_CONTEXT)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final()
  ]).toString('utf8')
}

function filePath(): string {
  return join(app.getPath('userData'), 'newsletter-history.bin')
}

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation)
  operations = result.catch(() => {})
  return result
}

async function initialize(): Promise<void> {
  if (loaded) return
  loaded = true
  try {
    const encrypted = await readFile(filePath())
    info.hasSavedHistory = true
    if (!secureStorageAvailable()) throw new Error('Secure history storage is unavailable.')
    const saved: unknown = JSON.parse(decryptHistory(encrypted))
    validateHistory(saved)
    state = saved
    info.mode = 'encrypted'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try {
        info.mode = secureStorageAvailable() ? 'encrypted' : 'session'
      } catch {
        info.mode = 'session'
      }
    } else {
      // Preserve unreadable encrypted history. Scans may continue in memory,
      // but must not replace saved data that could become readable later.
      info.locked = true
      info.mode = 'session'
    }
  }
}

export function loadHistory(): Promise<HistoryLoadResult> {
  return serial(async () => {
    await initialize()
    return { ...info, state: JSON.parse(JSON.stringify(state)) as PersistedState }
  })
}

export function saveHistory(value: unknown): Promise<HistoryStorageInfo> {
  validateHistory(value)
  // Keep only scan metadata; the current candidate list contains the history.
  const snapshot: PersistedState = {
    candidates: value.candidates,
    lastScan: value.lastScan ? { ...value.lastScan, candidates: [] } : undefined
  }
  const serialized = JSON.stringify(snapshot)
  if (Buffer.byteLength(serialized) > MAX_HISTORY_BYTES)
    throw new Error('Newsletter history is too large to save.')
  return serial(async () => {
    await initialize()
    state = JSON.parse(serialized) as PersistedState
    if (info.locked) return { ...info }
    const temporary = `${filePath()}.tmp`
    try {
      if (!secureStorageAvailable()) {
        info.mode = 'session'
        return { ...info }
      }
      const encrypted = encryptHistory(serialized)
      await mkdir(app.getPath('userData'), { recursive: true })
      await writeFile(temporary, encrypted, { mode: 0o600, flag: 'wx', flush: true })
      await rename(temporary, filePath())
      info = { mode: 'encrypted', locked: false, hasSavedHistory: true }
    } catch {
      info.mode = 'session'
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
    return { ...info }
  })
}

export function clearHistory(): Promise<HistoryStorageInfo> {
  return serial(async () => {
    await rm(filePath(), { force: true })
    await rm(`${filePath()}.tmp`, { force: true })
    state = { candidates: [] }
    loaded = true
    info.locked = false
    info.hasSavedHistory = false
    return { ...info }
  })
}
