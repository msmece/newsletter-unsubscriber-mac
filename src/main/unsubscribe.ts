import { activityFetch, openExternalWithActivity, serviceDestination } from './activity'
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
  const webLinks = candidate.unsubscribeUrls.filter(
    (url) => url.startsWith('http://') || url.startsWith('https://')
  )
  const mailtoLinks = candidate.unsubscribeUrls.filter((url) => url.startsWith('mailto:'))

  for (const url of webLinks) {
    if (!candidate.oneClick || !url.startsWith('https://')) {
      if (await openForManualAction(url)) {
        return {
          status: 'action-required',
          error:
            'Complete the unsubscribe steps in your browser, then mark this newsletter as unsubscribed.'
        }
      }
      continue
    }
    try {
      const response = await activityFetch(
        url,
        candidate.oneClick
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: 'List-Unsubscribe=One-Click'
            }
          : { method: 'GET' },
        candidate.oneClick
          ? 'Send a one-click unsubscribe request'
          : 'Visit the sender’s unsubscribe page',
        serviceDestination(url)
      )
      if (response.ok) {
        return { status: 'unsubscribed' }
      }
      if (await openForManualAction(url)) {
        return {
          status: 'action-required',
          requestFailed: true,
          error: `The sender returned HTTP ${response.status}; complete the unsubscribe flow in the opened page.`
        }
      }
    } catch {
      if (await openForManualAction(url)) {
        return {
          status: 'action-required',
          requestFailed: true,
          error: 'The link was opened because the sender does not allow direct requests.'
        }
      }
      return {
        status: 'failed',
        requestFailed: true,
        error: 'The unsubscribe request could not be completed.'
      }
    }
  }

  if (mailtoLinks.length > 0) {
    const opened = await openForManualAction(mailtoLinks[0])
    return opened
      ? {
          status: 'action-required',
          error: 'Complete the unsubscribe email, then mark this newsletter as unsubscribed.'
        }
      : { status: 'failed', error: 'The unsubscribe email could not be opened.' }
  }

  return {
    status: 'failed',
    error: 'The sender rejected the unsubscribe request.'
  }
}
