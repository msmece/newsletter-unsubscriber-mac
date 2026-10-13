import type { Session } from 'electron'
import { clearHistory } from './history'
import { clearPasswordHistory, savePasswordHistory } from './password-history'
import { clearActivity, getActivity } from './activity'
import type { HistoryStorageInfo } from '../shared/types'

export async function resetStats(
  session: Pick<Session, 'clearStorageData'>,
  encryptedHistory: unknown
): Promise<HistoryStorageInfo> {
  if (getActivity().some((entry) => entry.status === 'pending'))
    throw new Error('Wait for the current requests to finish before resetting statistics.')

  // Commit the empty password-protected history before removing older copies.
  // The password and its derived key remain in the renderer.
  if (encryptedHistory !== undefined) await savePasswordHistory(encryptedHistory)
  const info = await clearHistory()
  if (encryptedHistory === undefined) await clearPasswordHistory()
  await session.clearStorageData({ storages: ['localstorage'] })
  clearActivity()
  return info
}
