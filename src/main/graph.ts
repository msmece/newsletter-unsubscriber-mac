import { activityFetch } from './activity'
import { getAccessToken } from './auth'
import { GRAPH_BASE_URL } from './config'
import { candidateId, newestLinks, normalizeListId } from '../shared/newsletter'
import type { MailboxFolder, NewsletterCandidate, ScanResult } from '../shared/types'

interface GraphPage<T> {
  value?: T[]
  '@odata.nextLink'?: string
}

async function graphFetch<T>(url: string): Promise<GraphPage<T>> {
  const endpoint = new URL(url)
  if (
    endpoint.origin !== 'https://graph.microsoft.com' ||
    !endpoint.pathname.startsWith('/v1.0/me/mailFolders') ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error('An unexpected mailbox destination was blocked.')
  const token = await getAccessToken()
  const messages = endpoint.pathname.endsWith('/messages')
  const safePath = endpoint.pathname.replace(/(\/mailFolders\/)[^/]+/, '$1{folder}')
  const response = await activityFetch(
    url,
    { headers: { Authorization: `Bearer ${token}` } },
    messages ? 'Check a page of messages for newsletters' : 'Read your mail folders',
    `${endpoint.hostname} · ${safePath}`
  )
  if (!response.ok) {
    throw new Error(
      `Mailbox request failed (HTTP ${response.status}). Try again or reconnect your account.`
    )
  }
  return response.json() as Promise<GraphPage<T>>
}

interface GraphFolder {
  id: string
  displayName: string
  parentFolderId?: string
  childFolderCount: number
}

async function listChildFolders(folderId?: string): Promise<GraphFolder[]> {
  const base = folderId
    ? `${GRAPH_BASE_URL}/me/mailFolders/${encodeURIComponent(folderId)}/childFolders`
    : `${GRAPH_BASE_URL}/me/mailFolders`
  const folders: GraphFolder[] = []
  let url: string | undefined =
    `${base}?$top=100&$select=id,displayName,parentFolderId,childFolderCount`
  while (url) {
    const page = await graphFetch<GraphFolder>(url)
    folders.push(...(page.value ?? []))
    url = page['@odata.nextLink']
  }
  return folders
}

export async function getMailboxFolders(): Promise<MailboxFolder[]> {
  const result: MailboxFolder[] = []

  async function walk(folderId: string | undefined, depth: number): Promise<void> {
    const children = await listChildFolders(folderId)
    for (const folder of children) {
      result.push({
        id: folder.id,
        displayName: folder.displayName,
        parentFolderId: folder.parentFolderId,
        depth
      })
      if (folder.childFolderCount > 0) {
        await walk(folder.id, depth + 1)
      }
    }
  }

  await walk(undefined, 0)
  return result.sort((left, right) => left.displayName.localeCompare(right.displayName))
}

interface GraphHeader {
  name: string
  value: string
}

interface GraphMessage {
  id: string
  subject?: string
  from?: { emailAddress?: { address?: string; name?: string } }
  receivedDateTime?: string
  internetMessageHeaders?: GraphHeader[]
}

interface ParsedMessage {
  subject: string
  sender: string
  receivedAt: string
  listUnsubscribe: string[]
  listUnsubscribePost: boolean
  listId?: string
}

function headerMap(headers: GraphHeader[] | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const header of headers ?? []) {
    const name = header.name.toLowerCase()
    const value = header.value?.trim()
    if (name && value) {
      map.set(name, [...(map.get(name) ?? []), value])
    }
  }
  return map
}

function decodeHeaderValue(value: string): string {
  return value.replaceAll(/=\?[^?]+\?[bB]\?([^?]+)\?=/g, '$1').trim()
}

function parseUnsubscribeLinks(values: string[]): string[] {
  const links: string[] = []
  for (const value of values) {
    const decoded = decodeHeaderValue(value)
    for (const match of decoded.matchAll(/<([^>]+)>/g)) {
      try {
        const url = new URL(match[1].trim())
        if (['https:', 'http:', 'mailto:'].includes(url.protocol) && !links.includes(url.href)) {
          links.push(url.href)
        }
      } catch {
        // Malformed header URLs cannot be used for either automatic or manual actions.
      }
    }
  }
  return links
}

function parseMessage(message: GraphMessage): ParsedMessage | undefined {
  const headers = headerMap(message.internetMessageHeaders)
  const listUnsubscribe = parseUnsubscribeLinks(headers.get('list-unsubscribe') ?? [])
  if (listUnsubscribe.length === 0) {
    return undefined
  }
  const postHeaders = headers.get('list-unsubscribe-post') ?? []
  const listUnsubscribePost =
    headers.get('list-unsubscribe')?.length === 1 &&
    postHeaders.length === 1 &&
    /^List-Unsubscribe=One-Click$/i.test(postHeaders[0]) &&
    listUnsubscribe.filter((url) => /^https:\/\//i.test(url)).length === 1
  const listId = normalizeListId(headers.get('list-id')?.[0])
  return {
    subject: message.subject || '(no subject)',
    sender: message.from?.emailAddress?.address || 'Unknown sender',
    receivedAt: message.receivedDateTime || '',
    listUnsubscribe,
    listUnsubscribePost,
    listId: listId || undefined
  }
}

function candidateKey(message: ParsedMessage): string {
  return candidateId({
    sender: message.sender,
    listId: message.listId,
    unsubscribeUrls: message.listUnsubscribe
  })
}

function mergeCandidate(
  existing: NewsletterCandidate | undefined,
  message: ParsedMessage,
  folderName: string
): NewsletterCandidate {
  const now = new Date().toISOString()
  const unsubscribeLinks = newestLinks([
    ...message.listUnsubscribe.map((url) => ({
      url,
      oneClick: message.listUnsubscribePost && /^https:\/\//i.test(url),
      receivedAt: message.receivedAt
    })),
    ...(existing?.unsubscribeLinks ?? [])
  ]).slice(0, 100)
  const receivedAt = message.receivedAt
  if (!existing) {
    return {
      id: candidateKey(message),
      sender: message.sender,
      subject: message.subject,
      listId: message.listId,
      unsubscribeUrls: message.listUnsubscribe,
      unsubscribeLinks,
      oneClick: message.listUnsubscribePost,
      messageCount: 1,
      folderNames: [folderName],
      firstSeen: receivedAt,
      lastSeen: receivedAt,
      status: 'found',
      updatedAt: now
    }
  }
  return {
    ...existing,
    // Keep the original identity URL stable; request order comes from the links.
    unsubscribeUrls: [
      ...new Set([existing.unsubscribeUrls[0], ...unsubscribeLinks.map((link) => link.url)])
    ],
    unsubscribeLinks,
    oneClick: unsubscribeLinks.some((link) => link.oneClick),
    subject:
      receivedAt > (existing.lastSeen ?? existing.firstSeen) ? message.subject : existing.subject,
    firstSeen: receivedAt < existing.firstSeen ? receivedAt : existing.firstSeen,
    lastSeen:
      receivedAt > (existing.lastSeen ?? existing.firstSeen) ? receivedAt : existing.lastSeen,
    messageCount: existing.messageCount + 1,
    folderNames: [...new Set([...existing.folderNames, folderName])],
    updatedAt: now
  }
}

export async function scanFolders(
  folders: MailboxFolder[],
  onProgress: (message: string) => void
): Promise<ScanResult> {
  const candidates = new Map<string, NewsletterCandidate>()
  let messageCount = 0

  for (const folder of folders) {
    onProgress(`Scanning ${folder.displayName}...`)
    let url: string | undefined =
      `${GRAPH_BASE_URL}/me/mailFolders/${encodeURIComponent(folder.id)}/messages` +
      '?$top=50&$select=subject,from,receivedDateTime,internetMessageHeaders'
    while (url) {
      const page = await graphFetch<GraphMessage>(url)
      const messages: GraphMessage[] = page.value ?? []
      messageCount += messages.length
      for (const raw of messages) {
        const parsed = parseMessage(raw)
        if (parsed) {
          const key = candidateKey(parsed)
          candidates.set(key, mergeCandidate(candidates.get(key), parsed, folder.displayName))
        }
      }
      url = page['@odata.nextLink']
      if (messages.length > 0) {
        onProgress(`${folder.displayName}: ${messageCount.toLocaleString()} messages checked`)
      }
    }
  }

  return {
    candidates: [...candidates.values()].sort((left, right) =>
      left.sender.localeCompare(right.sender)
    ),
    messageCount,
    scannedFolderIds: folders.map(({ id }) => id),
    scannedAt: new Date().toISOString()
  }
}
