import type { NewsletterCandidate, UnsubscribeOutcome } from '../../shared/types'

export function senderDomain(sender: string): string {
  return sender
    .slice(sender.lastIndexOf('@') + 1)
    .trim()
    .toLowerCase()
}

export async function runDomainBatch(
  selected: NewsletterCandidate[],
  history: NewsletterCandidate[],
  attempt: (candidate: NewsletterCandidate) => Promise<UnsubscribeOutcome>,
  onResult: (candidate: NewsletterCandidate, outcome: UnsubscribeOutcome) => void,
  onSkip: (candidate: NewsletterCandidate, domain: string) => void
): Promise<void> {
  const blocked = new Set(
    history
      .filter(
        (item) => item.status === 'failed' || (item.status !== 'unsubscribed' && item.requestFailed)
      )
      .map((item) => senderDomain(item.sender))
  )
  for (const candidate of selected) {
    const domain = senderDomain(candidate.sender)
    if (blocked.has(domain)) {
      onSkip(candidate, domain)
      continue
    }
    let outcome: UnsubscribeOutcome
    try {
      outcome = await attempt(candidate)
    } catch {
      outcome = {
        status: 'failed',
        requestFailed: true,
        error: 'The request could not be completed. Try this newsletter individually.'
      }
    }
    if (outcome.status === 'failed' || outcome.requestFailed) blocked.add(domain)
    onResult(candidate, outcome)
  }
}
