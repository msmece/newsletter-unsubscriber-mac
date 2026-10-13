import type {
  NewsletterCandidate,
  PersistedState,
  ScanResult,
  HistoryStorageInfo
} from '../../shared/types'
import { candidateId } from '../../shared/newsletter'
import {
  createHistoryPassword,
  encryptPasswordHistory,
  unlockPasswordHistory
} from './history-crypto'
import type { HistoryPasswordKey } from './history-crypto'

const STORAGE_KEY = 'newsletter-unsubscriber:v1'
const PASSWORD_KEY = 'newsletter-unsubscriber:encrypted-history:v1'

const emptyState: PersistedState = { candidates: [] }

let legacyPending = false
let storageMessage = ''
let passwordContext: HistoryPasswordKey | undefined
let passwordLocked = false
let passwordFileAvailable = false
let passwordBackupPending = false

function passwordNotice(): void {
  storageMessage = passwordBackupPending
    ? 'A password-encrypted backup is saved. Restart the app to finish removing the old plaintext browser database.'
    : 'History is encrypted with your password. You will need it after restarting or reloading the app.'
}

async function passwordCiphertext(): Promise<string | null> {
  const browser = window.localStorage.getItem(PASSWORD_KEY)
  if (!passwordFileAvailable) return browser
  return browser ?? (await window.api.history.loadPassword())
}

async function commitPasswordCiphertext(encrypted: string): Promise<void> {
  if (passwordFileAvailable) {
    await window.api.history.savePassword(encrypted)
    if (
      legacyPending ||
      passwordBackupPending ||
      window.localStorage.getItem(PASSWORD_KEY) !== null
    ) {
      try {
        await window.api.history.purgeLegacy()
        window.localStorage.removeItem(STORAGE_KEY)
        window.localStorage.removeItem(PASSWORD_KEY)
        legacyPending = false
        passwordBackupPending = false
      } catch {
        passwordBackupPending = true
      }
    }
  } else {
    // Preserve a live session across a renderer-only update. A later restart
    // migrates this encrypted backup to a file before purging the old database.
    window.localStorage.setItem(PASSWORD_KEY, encrypted)
    window.localStorage.removeItem(STORAGE_KEY)
    legacyPending = false
    passwordBackupPending = true
  }
  passwordNotice()
}

export function historyPasswordLocked(): boolean {
  return passwordLocked
}

export function historyPasswordEnabled(): boolean {
  return passwordContext !== undefined || passwordLocked
}

export async function protectHistoryWithPassword(
  state: PersistedState,
  password: string
): Promise<void> {
  if (passwordLocked) throw new Error('Unlock your saved history before changing its password.')
  const context = await createHistoryPassword(password)
  await commitPasswordCiphertext(await encryptPasswordHistory(state, context))
  passwordContext = context
  legacyPending = false
  passwordNotice()
}

export async function unlockHistoryWithPassword(password: string): Promise<PersistedState> {
  const encrypted = await passwordCiphertext()
  if (!encrypted) throw new Error('No password-protected history was found.')
  const unlocked = await unlockPasswordHistory(encrypted, password)
  const state = normalized(unlocked.state)
  if (
    passwordFileAvailable &&
    (window.localStorage.getItem(PASSWORD_KEY) !== null || legacyPending)
  ) {
    // Authenticate the backup before migration can delete the legacy database.
    try {
      await commitPasswordCiphertext(encrypted)
    } catch {
      passwordBackupPending = true
    }
  }
  passwordContext = unlocked.context
  passwordLocked = false
  passwordNotice()
  return state
}

export function historyStorageMessage(): string {
  return storageMessage
}

function storageNotice(info: HistoryStorageInfo): void {
  storageMessage = info.locked
    ? 'Saved encrypted history could not be opened. Allow Keychain access and restart the app; new changes stay in this session.'
    : info.mode === 'session'
      ? 'History is kept only for this session because secure storage is unavailable.'
      : ''
  if (legacyPending)
    storageMessage += `${storageMessage ? ' ' : ''}Existing browser history is still unencrypted. Allow Keychain access and restart to migrate it.`
}

async function removeLegacy(): Promise<void> {
  try {
    // Clear Chromium's local-storage database only after the encrypted write is
    // committed, rather than leaving deleted history records in that database.
    await window.api.history.purgeLegacy()
    window.localStorage.removeItem(STORAGE_KEY)
    legacyPending = false
  } catch {
    storageMessage =
      'History is encrypted, but its old browser copy could not be removed. Restart to retry cleanup.'
  }
}

function normalized(state: PersistedState): PersistedState {
  return {
    ...state,
    candidates: state.candidates.map((candidate) => ({ ...candidate, id: candidateId(candidate) }))
  }
}

export async function loadState(): Promise<PersistedState> {
  let encryptedFile: string | null = null
  try {
    encryptedFile = await window.api.history.loadPassword()
    passwordFileAvailable = true
  } catch (error) {
    // Older running main processes do not have password-file IPC yet.
    if (
      typeof window.api.history.loadPassword === 'function' &&
      !(error instanceof Error && error.message.includes('No handler registered'))
    ) {
      passwordLocked = true
      storageMessage =
        'Password-protected history could not be loaded. Your saved file has been preserved.'
      return emptyState
    }
    passwordFileAvailable = false
  }
  const encryptedBrowser = window.localStorage.getItem(PASSWORD_KEY)
  legacyPending = window.localStorage.getItem(STORAGE_KEY) !== null
  if (encryptedBrowser !== null) passwordBackupPending = true
  if (encryptedFile !== null || encryptedBrowser !== null) {
    passwordLocked = true
    storageMessage = 'Your saved history is encrypted. Enter its password to unlock it.'
    return emptyState
  }
  const saved = await window.api.history.load()
  const raw = window.localStorage.getItem(STORAGE_KEY)
  legacyPending = raw !== null
  storageNotice(saved)
  if (saved.mode === 'session' && saved.state.candidates.length > 0) {
    // Preserve the current backend snapshot on a renderer reload, rather than
    // replacing recent session changes with an older legacy browser record.
    return normalized(saved.state)
  }
  if (saved.mode === 'encrypted' && saved.hasSavedHistory) {
    if (legacyPending) await removeLegacy()
    if (!legacyPending) storageNotice(saved)
    return normalized(saved.state)
  }
  if (!raw) return normalized(saved.state)
  let legacy: PersistedState
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as PersistedState).candidates)
    )
      throw new Error('Invalid legacy history.')
    legacy = normalized(parsed as PersistedState)
  } catch {
    storageMessage = 'The old browser history could not be read. Reset all stats removes it.'
    return emptyState
  }
  await saveState(legacy)
  return legacy
}

export async function saveState(state: PersistedState): Promise<void> {
  if (passwordLocked) {
    storageMessage = 'Unlock your encrypted history before changing it.'
    return
  }
  if (passwordContext) {
    try {
      await commitPasswordCiphertext(await encryptPasswordHistory(state, passwordContext))
    } catch {
      storageMessage =
        'Encrypted history could not be saved. Your latest changes are available in this session.'
    }
    return
  }
  try {
    const info = await window.api.history.save(state)
    storageNotice(info)
    if (info.mode === 'encrypted' && legacyPending) {
      await removeLegacy()
      if (!legacyPending) storageNotice(info)
    }
  } catch {
    storageMessage =
      'History could not be saved. Your latest changes are available in this session.' +
      (legacyPending ? ' Existing browser history remains unencrypted.' : '')
  }
}

export function mergeScanWithHistory(
  scan: ScanResult,
  previous: NewsletterCandidate[]
): NewsletterCandidate[] {
  const history = new Map(previous.map((candidate) => [candidateId(candidate), candidate]))
  const current = scan.candidates.map((candidate) => {
    const old = history.get(candidate.id)
    history.delete(candidate.id)
    if (
      old?.status === 'unsubscribed' &&
      Date.parse(candidate.lastSeen ?? candidate.firstSeen) > Date.parse(old.updatedAt)
    ) {
      return {
        ...candidate,
        error:
          'New mail arrived after your last request. Delivery can take time to stop; you can retry.'
      }
    }
    return old
      ? {
          ...candidate,
          status: old.status,
          error: old.error,
          requestFailed: old.requestFailed,
          completion: old.completion,
          manualUrl: candidate.unsubscribeUrls.includes(old.manualUrl ?? '')
            ? old.manualUrl
            : undefined,
          updatedAt: old.updatedAt
        }
      : candidate
  })
  // A scan of other folders must not erase completion history or domain failures.
  return [...current, ...history.values()].sort((left, right) =>
    left.sender.localeCompare(right.sender)
  )
}

export async function clearState(): Promise<void> {
  await window.api.history.clear()
  window.localStorage.removeItem(STORAGE_KEY)
  window.localStorage.removeItem(PASSWORD_KEY)
  passwordContext = undefined
  passwordLocked = false
  passwordBackupPending = false
  legacyPending = false
  storageMessage = ''
}

export async function resetState(): Promise<void> {
  if (passwordLocked) throw new Error('Unlock your history before resetting statistics.')
  const encrypted = passwordContext
    ? await encryptPasswordHistory({ candidates: [] }, passwordContext)
    : undefined
  const info = await window.api.history.reset(encrypted)
  window.localStorage.removeItem(STORAGE_KEY)
  window.localStorage.removeItem(PASSWORD_KEY)
  legacyPending = false
  passwordBackupPending = false
  if (passwordContext) {
    passwordFileAvailable = true
    passwordNotice()
  } else storageNotice(info)
}
