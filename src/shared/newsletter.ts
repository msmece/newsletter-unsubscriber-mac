import type { NewsletterCandidate, UnsubscribeLink } from './types'

export function normalizeListId(value?: string): string | undefined {
  return (value?.match(/<([^>]+)>/)?.[1] ?? value)?.trim() || undefined
}

export function candidateId(
  candidate: Pick<NewsletterCandidate, 'sender' | 'listId' | 'unsubscribeUrls'>
): string {
  const listId = normalizeListId(candidate.listId)
  let identity = listId?.toLowerCase() ?? candidate.unsubscribeUrls[0] ?? ''
  if (!listId) {
    try {
      // URL normalizes the host and scheme while preserving case-sensitive tokens.
      identity = new URL(identity).href
    } catch {
      // Invalid destinations will be rejected by the main process before use.
    }
  }
  return `${candidate.sender.toLowerCase()}|${identity}`
}

export function newestLinks(links: UnsubscribeLink[]): UnsubscribeLink[] {
  const sorted = [...links].sort(
    (left, right) => (Date.parse(right.receivedAt) || 0) - (Date.parse(left.receivedAt) || 0)
  )
  const seen = new Set<string>()
  return sorted.filter((link) => {
    if (seen.has(link.url)) return false
    seen.add(link.url)
    return true
  })
}
