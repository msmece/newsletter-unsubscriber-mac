import type { MailboxFolder, NewsletterCandidate } from '../shared/types'

function text(value: unknown, max = 8192): value is string {
  return typeof value === 'string' && value.length <= max
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 500 && value.every((item) => text(item))
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
    !strings(item.unsubscribeUrls) ||
    !strings(item.folderNames) ||
    typeof item.oneClick !== 'boolean' ||
    !Number.isInteger(item.messageCount) ||
    item.messageCount < 0 ||
    !['found', 'failed', 'action-required', 'unsubscribed'].includes(item.status)
  )
    throw new Error('Invalid newsletter selection.')
}
