import type { NewsletterCandidate, PersistedState, ScanResult } from '../../shared/types'

const STORAGE_KEY = 'newsletter-unsubscriber:v1'

const emptyState: PersistedState = { candidates: [] }

export function loadState(): PersistedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return emptyState
    }
    const parsed: unknown = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as PersistedState).candidates)
    ) {
      throw new Error('Stored dashboard data has an unexpected shape.')
    }
    return parsed as PersistedState
  } catch (error) {
    console.warn('Ignoring unreadable newsletter dashboard data.', error)
    return emptyState
  }
}

export function saveState(state: PersistedState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.warn('Could not persist newsletter dashboard data.', error)
  }
}

export function mergeScanWithHistory(
  scan: ScanResult,
  previous: NewsletterCandidate[]
): NewsletterCandidate[] {
  return scan.candidates.map((candidate) => {
    const old = previous.find((item) => item.id === candidate.id)
    return old
      ? {
          ...candidate,
          status: old.status,
          error: old.error,
          requestFailed: old.requestFailed,
          updatedAt: old.updatedAt
        }
      : candidate
  })
}

export function clearState(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.warn('Could not clear newsletter dashboard data.', error)
  }
}
