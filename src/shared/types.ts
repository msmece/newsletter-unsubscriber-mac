export interface MailboxFolder {
  id: string
  displayName: string
  parentFolderId?: string
  depth: number
}

export type NewsletterStatus = 'found' | 'unsubscribed' | 'failed' | 'action-required'

export interface NewsletterCandidate {
  id: string
  sender: string
  subject: string
  listId?: string
  unsubscribeUrls: string[]
  oneClick: boolean
  messageCount: number
  folderNames: string[]
  firstSeen: string
  status: NewsletterStatus
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

export interface UnsubscribeOutcome {
  status: NewsletterStatus
  error?: string
  requestFailed?: boolean
}

export interface AccountInfo {
  username: string
  name?: string
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
