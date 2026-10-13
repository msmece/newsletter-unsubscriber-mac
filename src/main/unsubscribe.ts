import { activityFetch, openExternalWithActivity, serviceDestination } from './activity'
import { newestLinks } from '../shared/newsletter'
import type { NewsletterCandidate, UnsubscribeOutcome } from '../shared/types'

async function openForManualAction(url: string): Promise<boolean> {
  try {
    await openExternalWithActivity(url)
    return true
  } catch {
    return false
  }
}

export async function unsubscribe(candidate: NewsletterCandidate): Promise<UnsubscribeOutcome> {
  // The old aggregate flag cannot tell which message advertised one-click for
  // which URL. Saved legacy links stay manual until a rescan supplies provenance.
  const links = newestLinks(
    candidate.unsubscribeLinks ??
      candidate.unsubscribeUrls.map((url) => ({ url, oneClick: false, receivedAt: '' }))
  )
  const automatic = links.filter((link) => link.oneClick && /^https:\/\//i.test(link.url))
  let requestFailed = false
  let failure = ''

  // Avoid a long retry storm when a list has many expired message-specific links.
  for (const { url } of automatic.slice(0, 5)) {
    try {
      const response = await activityFetch(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'List-Unsubscribe=One-Click'
        },
        'Send a one-click unsubscribe request',
        serviceDestination(url)
      )
      if (response.ok) return { status: 'unsubscribed', requestFailed }
      failure = `The sender returned HTTP ${response.status}.`
      if (response.status === 429) {
        requestFailed = true
        break
      }
    } catch {
      failure = 'The unsubscribe service could not be reached.'
    }
    requestFailed = true
  }

  // Exhaust automatic alternatives before opening a browser. Prefer a manual
  // page to an automatic URL that has already failed, then try email alternatives.
  const manual = [
    ...links.filter((link) => !link.oneClick && /^https:\/\//i.test(link.url)),
    ...automatic,
    ...links.filter((link) => /^mailto:/i.test(link.url))
  ]
  for (const { url } of manual) {
    if (await openForManualAction(url)) {
      const email = /^mailto:/i.test(url)
      return {
        status: 'action-required',
        requestFailed,
        manualUrl: url,
        error: `${failure ? `${failure} ` : ''}${
          email
            ? 'Review and send the unsubscribe email, then mark this newsletter as completed.'
            : 'Complete the unsubscribe steps in your browser, then mark this newsletter as completed.'
        }`
      }
    }
  }

  return {
    status: 'failed',
    requestFailed,
    error: failure || 'No supported unsubscribe link could be opened.'
  }
}
