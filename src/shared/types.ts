export interface MailboxFolder {
  id: string
  displayName: string
  parentFolderId?: string
  depth: number
}

export type NewsletterStatus = 'found' | 'unsubscribed' | 'failed' | 'action-required'

export interface UnsubscribeLink {
  url: string
  oneClick: boolean
  receivedAt: string
}

export interface NewsletterCandidate {
  id: string
  sender: string
  subject: string
  listId?: string
  unsubscribeUrls: string[]
  // Older saved results have no per-message capability information.
  unsubscribeLinks?: UnsubscribeLink[]
  oneClick: boolean
  messageCount: number
  folderNames: string[]
  firstSeen: string
  lastSeen?: string
  status: NewsletterStatus
  completion?: 'request' | 'manual'
  manualUrl?: string
  error?: string
  requestFailed?: boolean
  updatedAt: string
}

export interface ScanResult {
  candidates: NewsletterCandidate[]
  messageCount: number
  scannedFolderIds: string[]
  scannedAt: string
}

export interface PersistedState {
  candidates: NewsletterCandidate[]
  lastScan?: ScanResult
}

export interface HistoryStorageInfo {
  mode: 'encrypted' | 'session'
  locked: boolean
  hasSavedHistory: boolean
}

export interface HistoryLoadResult extends HistoryStorageInfo {
  state: PersistedState
}

export interface UnsubscribeOutcome {
  status: NewsletterStatus
  error?: string
  requestFailed?: boolean
  manualUrl?: string
}

export interface AccountInfo {
  username: string
  name?: string
  sessionOnly?: boolean
}

export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  message: string
}

export interface ActivityEntry {
  id: string
  title: string
  destination: string
  method: string
  status: 'pending' | 'success' | 'failed' | 'action-required'
  detail: string
  startedAt: string
  requestBody?: string
  contentType?: string
  durationMs?: number
}
