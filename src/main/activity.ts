import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
import { externalUrl, publicPost } from './network'
import type { ActivityEntry } from '../shared/types'

const entries: ActivityEntry[] = []
const listeners = new Set<(entries: ActivityEntry[]) => void>()

export function getActivity(): ActivityEntry[] {
  return entries.map((entry) => ({ ...entry }))
}

export function onActivity(listener: (entries: ActivityEntry[]) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(): void {
  for (const listener of listeners) listener(getActivity())
}

export function clearActivity(): void {
  entries.splice(0, entries.length, ...entries.filter((entry) => entry.status === 'pending'))
  publish()
}

export function beginActivity(
  title: string,
  destination: string,
  method: string,
  payload: Pick<ActivityEntry, 'requestBody' | 'contentType'> = {}
): (status: ActivityEntry['status'], detail: string) => void {
  const started = Date.now()
  const entry: ActivityEntry = {
    id: randomUUID(),
    title,
    destination,
    method,
    ...payload,
    status: 'pending',
    detail: 'In progress…',
    startedAt: new Date().toISOString()
  }
  entries.unshift(entry)
  entries.splice(200)
  publish()
  return (status, detail) => {
    entry.status = status
    entry.detail = detail
    entry.durationMs = Date.now() - started
    publish()
  }
}

// Never retain full unsubscribe URLs: paths and queries may contain personal tokens.
export function serviceDestination(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'mailto:') return 'Your email app'
    return parsed.hostname || 'External service'
  } catch {
    return 'External service'
  }
}

export async function activityFetch(
  url: string,
  init: RequestInit | undefined,
  title: string,
  destination: string
): Promise<Response> {
  const method = init?.method ?? 'GET'
  // Only the known, non-personal one-click payload may be recorded.
  const safeBody = method === 'POST' && init?.body === 'List-Unsubscribe=One-Click'
  const finish = beginActivity(
    title,
    destination,
    method,
    safeBody
      ? { requestBody: String(init.body), contentType: 'application/x-www-form-urlencoded' }
      : {}
  )
  try {
    const response = safeBody
      ? await publicPost(url, String(init.body))
      : await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) })
    finish(
      response.ok ? 'success' : 'failed',
      response.ok
        ? `The service replied successfully (HTTP ${response.status}).`
        : `The service could not complete the request (HTTP ${response.status}).`
    )
    return response
  } catch (error) {
    finish('failed', 'No response was received. Check your connection and try again.')
    throw error
  }
}

export async function openExternalWithActivity(url: string): Promise<void> {
  const email = url.startsWith('mailto:')
  const finish = beginActivity(
    email ? 'Open an unsubscribe email' : 'Open a page in your browser',
    serviceDestination(url),
    email ? 'Email app' : 'Browser'
  )
  try {
    externalUrl(url)
    await shell.openExternal(url)
    finish(
      'action-required',
      email
        ? 'Your email app was opened. Review and send the email to continue.'
        : 'The page was opened. Complete any steps shown in your browser.'
    )
  } catch (error) {
    finish('failed', 'The external app could not be opened. Please try again.')
    throw error
  }
}
