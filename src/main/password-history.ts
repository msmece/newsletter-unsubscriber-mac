import { app } from 'electron'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

let operations: Promise<unknown> = Promise.resolve()

function path(): string {
  return join(app.getPath('userData'), 'newsletter-history-password.bin')
}

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation)
  operations = result.catch(() => {})
  return result
}

function validate(value: unknown): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 30 * 1024 * 1024)
    throw new Error('Invalid password-protected history.')
  const envelope = JSON.parse(value)
  if (
    !envelope ||
    envelope.version !== 1 ||
    envelope.kdf !== 'PBKDF2-SHA256' ||
    envelope.iterations !== 600000 ||
    !['salt', 'iv', 'data'].every((field) => typeof envelope[field] === 'string') ||
    Buffer.from(envelope.salt, 'base64').length !== 32 ||
    Buffer.from(envelope.iv, 'base64').length !== 12 ||
    Buffer.from(envelope.data, 'base64').length < 16
  )
    throw new Error('Invalid password-protected history.')
}

export function loadPasswordHistory(): Promise<string | null> {
  return serial(async () => {
    try {
      const encrypted = await readFile(path(), 'utf8')
      validate(encrypted)
      return encrypted
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('Password-protected history could not be read.')
    }
  })
}

export function savePasswordHistory(value: unknown): Promise<void> {
  validate(value)
  return serial(async () => {
    const temporary = `${path()}.tmp`
    try {
      await mkdir(app.getPath('userData'), { recursive: true })
      await writeFile(temporary, value, { mode: 0o600, flag: 'wx', flush: true })
      await rename(temporary, path())
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
  })
}

export function clearPasswordHistory(): Promise<void> {
  return serial(async () => {
    await rm(path(), { force: true })
    await rm(`${path()}.tmp`, { force: true })
  })
}
