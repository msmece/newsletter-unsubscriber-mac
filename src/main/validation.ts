import type { MailboxFolder, NewsletterCandidate, PersistedState } from '../shared/types'

function text(value: unknown, max = 8192): value is string {
  return typeof value === 'string' && value.length <= max
}
function strings(value: unknown, limit = 500): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every((item) => text(item))
}
export function validateFolders(value: unknown): asserts value is MailboxFolder[] {
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    !value.every(
      (item) =>
        item &&
        text(item.id, 2048) &&
        text(item.displayName, 1024) &&
        Number.isInteger(item.depth) &&
        item.depth >= 0 &&
        item.depth <= 100
    )
  )
    throw new Error('Invalid mail folder selection.')
}
export function validateCandidate(value: unknown): asserts value is NewsletterCandidate {
  const item = value as NewsletterCandidate
  if (
    !item ||
    !text(item.id) ||
    !text(item.sender, 1024) ||
    !text(item.subject) ||
    (item.listId !== undefined && !text(item.listId)) ||
    !strings(item.unsubscribeUrls) ||
    (item.unsubscribeLinks !== undefined &&
      (!Array.isArray(item.unsubscribeLinks) ||
        item.unsubscribeLinks.length > 500 ||
        !item.unsubscribeLinks.every(
          (link) =>
            link &&
            text(link.url) &&
            item.unsubscribeUrls.includes(link.url) &&
            typeof link.oneClick === 'boolean' &&
            text(link.receivedAt, 100)
        ))) ||
    !strings(item.folderNames) ||
    typeof item.oneClick !== 'boolean' ||
    !Number.isInteger(item.messageCount) ||
    item.messageCount < 0 ||
    !['found', 'failed', 'action-required', 'unsubscribed'].includes(item.status)
  )
    throw new Error('Invalid newsletter selection.')
}

export function validateHistory(value: unknown): asserts value is PersistedState {
  const state = value as PersistedState
  if (!state || !Array.isArray(state.candidates) || state.candidates.length > 10000)
    throw new Error('Invalid saved newsletter history.')
  for (const candidate of state.candidates) {
    validateCandidate(candidate)
    if (!text(candidate.firstSeen, 100) || !text(candidate.updatedAt, 100))
      throw new Error('Invalid saved newsletter history.')
  }
  if (state.lastScan !== undefined) {
    const scan = state.lastScan
    if (
      !scan ||
      !Number.isSafeInteger(scan.messageCount) ||
      scan.messageCount < 0 ||
      !text(scan.scannedAt, 100) ||
      !strings(scan.scannedFolderIds, 1000)
    )
      throw new Error('Invalid saved scan history.')
  }
}
