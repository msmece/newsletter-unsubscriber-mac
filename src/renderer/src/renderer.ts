import './styles.css'
import { runDomainBatch } from './bulk'
import { loadState, mergeScanWithHistory, saveState, clearState } from './storage'
import type {
  ActivityEntry,
  AccountInfo,
  DeviceCodeInfo,
  MailboxFolder,
  NewsletterCandidate,
  PersistedState
} from '../../shared/types'

const app =
  document.querySelector<HTMLElement>('#app') ??
  (() => {
    throw new Error('Newsletter Unsubscriber could not find its application root.')
  })()

let account: AccountInfo | null = null
let deviceCode: DeviceCodeInfo | null = null
let folders: MailboxFolder[] = []
let selectedFolderIds = new Set<string>()
let selectedCandidateIds = new Set<string>()
let state: PersistedState = loadState()
let statusMessage = 'Sign in to get started.'
let isBusy = false
let activeView: 'newsletters' | 'folders' | 'insights' | 'activity' = 'newsletters'
let activeFilter = 'all'
let searchQuery = ''
let activityEntries: ActivityEntry[] = []
const skippedCandidates = new Map<string, string>()

const SELECTABLE_STATUSES: NewsletterCandidate['status'][] = ['found', 'failed']

function getSenderDomain(sender: string): string {
  const at = sender.lastIndexOf('@')
  return (at >= 0 ? sender.slice(at + 1) : sender).toLowerCase()
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) {
    node.textContent = text
  }
  if (className) {
    node.className = className
  }
  return node
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = element('button', label, className)
  node.type = 'button'
  node.disabled = isBusy
  node.addEventListener('click', onClick)
  return node
}

function formatDate(value?: string): string {
  if (!value) {
    return 'Not scanned yet'
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value)
  )
}

function statusLabel(status: NewsletterCandidate['status']): string {
  switch (status) {
    case 'unsubscribed':
      return 'Unsubscribed'
    case 'failed':
      return 'Failed'
    case 'action-required':
      return 'Action required'
    default:
      return 'Found'
  }
}

function statusClass(status: NewsletterCandidate['status']): string {
  return `status status-${status}`
}

function icon(name: string): SVGSVGElement {
  const paths: Record<string, string> = {
    mail: 'M3 5h18v14H3z M3 6l9 7 9-7',
    folders: 'M3 7V5h6l2 2h10v12H3z',
    activity: 'M3 12h4l3-8 4 16 3-8h4',
    insights: 'M4 20V10m8 10V4m8 16v-7',
    check: 'M5 12l4 4L19 6',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
    scan: 'M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5M8 12h8'
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.7')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', paths[name] ?? paths.mail)
  svg.append(path)
  return svg
}

function brand(): HTMLElement {
  const node = element('div', undefined, 'brand')
  const mark = element('span', undefined, 'brand-mark')
  mark.append(icon('mail'))
  node.append(mark, element('span', 'Unsubscriber'))
  return node
}

function renderSignIn(parent: HTMLElement): void {
  parent.classList.add('welcome-shell')
  const section = element('main', undefined, 'sign-in-panel')
  section.append(
    brand(),
    element('p', 'TAKE BACK YOUR INBOX', 'eyebrow'),
    element('h1', 'Goodbye,\nunwanted email.'),
    element(
      'p',
      'Find your newsletters. Keep your favorites. Unsubscribe from the rest, all in one place.',
      'welcome-description'
    )
  )
  if (deviceCode) {
    const box = element('div', undefined, 'device-code-box')
    box.append(
      element('p', 'Enter this code on Microsoft’s verification page:'),
      element('p', deviceCode.userCode, 'device-code')
    )
    const link = element('a', 'Continue to Microsoft')
    link.href = deviceCode.verificationUri
    link.target = '_blank'
    link.rel = 'noreferrer'
    box.append(link)
    section.append(box)
  } else {
    const connect = button(
      isBusy ? 'Connecting…' : 'Continue with Microsoft',
      'button button-primary connect-button',
      startSignIn
    )
    const microsoft = element('span', undefined, 'microsoft-mark')
    microsoft.setAttribute('aria-hidden', 'true')
    for (let i = 0; i < 4; i++) microsoft.append(element('i'))
    connect.prepend(microsoft)
    connect.append(icon('arrow'))
    section.append(connect)
  }
  section.append(element('p', 'For Microsoft 365 and Outlook accounts', 'connection-note'))
  const features = element('div', undefined, 'welcome-features')
  for (const [title, description] of [
    ['Read-only access', 'We never move or delete your emails.'],
    ['Private by design', 'Your scan history stays on this Mac.']
  ]) {
    const feature = element('div', undefined, 'welcome-feature')
    feature.append(icon('shield'))
    const copy = element('div')
    copy.append(element('strong', title), element('p', description))
    feature.append(copy)
    features.append(feature)
  }
  const status = element('p', statusMessage, 'status-message')
  status.setAttribute('role', 'status')
  section.append(features, status)
  const activityDetails = element('details', undefined, 'signin-activity')
  activityDetails.append(element('summary', 'Connection activity'))
  const activityContent = element('div')
  activityContent.id = 'activity-content'
  renderActivity(activityContent)
  activityDetails.append(activityContent)
  section.append(activityDetails)
  const preview = element('aside', undefined, 'welcome-preview')
  const previewHeading = element('div', undefined, 'preview-heading')
  previewHeading.append(
    element('span', 'LESS CLUTTER. MORE CLARITY.', 'eyebrow'),
    element('h2', 'An inbox that feels\nlike yours again.')
  )
  preview.append(previewHeading)
  const demo = element('div', undefined, 'preview-card')
  const top = element('div', undefined, 'preview-top')
  top.append(element('strong', 'Your newsletters'), element('span', 'Preview', 'preview-label'))
  demo.append(top, element('p', 'A few less things on your reading list.', 'preview-description'))
  for (const [initial, name, subject, done] of [
    ['S', 'Studio Notes', 'A little creative inspiration', false],
    ['D', 'Daily Dispatch', 'Your daily roundup', true],
    ['W', 'Weekend Edit', 'Something for your Saturday', true]
  ]) {
    const row = element('div', undefined, `preview-row ${done ? 'preview-done' : ''}`)
    row.append(element('span', initial as string, 'sender-avatar'))
    const copy = element('div', undefined, 'preview-row-copy')
    copy.append(element('strong', name as string), element('span', subject as string))
    row.append(
      copy,
      element(
        'span',
        done ? 'Unsubscribed' : 'Subscribed',
        done ? 'status status-unsubscribed' : 'status status-found'
      )
    )
    demo.append(row)
  }
  const complete = element('div', undefined, 'preview-complete')
  complete.append(icon('check'), element('span', 'Two fewer newsletters. One cleaner inbox.'))
  demo.append(complete)
  preview.append(demo, element('p', 'Choose what deserves your attention.', 'preview-caption'))
  parent.append(section, preview)
}

function renderStats(parent: HTMLElement): void {
  const stats = element('section', undefined, 'stats')
  const values = [
    ['Newsletters found', state.candidates.length, 'stat-found'],
    [
      'Unsubscribed',
      state.candidates.filter((item) => item.status === 'unsubscribed').length,
      'stat-success'
    ],
    ['Failed', state.candidates.filter((item) => item.status === 'failed').length, 'stat-failed'],
    [
      'Action required',
      state.candidates.filter((item) => item.status === 'action-required').length,
      'stat-action'
    ]
  ] as const
  for (const [label, value, className] of values) {
    const card = element('div', undefined, `stat-card ${className}`)
    card.append(
      element('span', label),
      element('strong', String(value)),
      element(
        'small',
        className === 'stat-found'
          ? 'Across your scanned folders'
          : className === 'stat-success'
            ? 'A little less inbox noise'
            : className === 'stat-failed'
              ? 'Ready for another try'
              : 'Finish in your browser'
      )
    )
    stats.append(card)
  }
  parent.append(stats)
}

function renderFolderPicker(parent: HTMLElement): void {
  const section = element('section', undefined, 'panel')
  const heading = element('div', undefined, 'panel-heading')
  heading.append(element('div', 'Mail folders', 'panel-title'))
  heading.append(
    element('div', 'Select which folders to scan for newsletter messages.', 'panel-description')
  )
  const toolbar = element('div', undefined, 'toolbar')
  toolbar.append(
    button('Select all', 'button button-quiet', () => {
      selectedFolderIds = new Set(folders.map(({ id }) => id))
      render()
    }),
    button('Clear', 'button button-quiet', () => {
      selectedFolderIds.clear()
      render()
    }),
    button('Refresh folders', 'button button-quiet', refreshFolders)
  )
  section.append(heading, toolbar)

  const list = element('div', undefined, 'folder-list')
  if (folders.length === 0) {
    list.append(element('p', 'No mail folders were returned.', 'muted'))
  } else {
    for (const folder of folders) {
      const label = element('label', undefined, 'folder-option')
      const checkbox = element('input') as HTMLInputElement
      checkbox.type = 'checkbox'
      checkbox.disabled = isBusy
      checkbox.checked = selectedFolderIds.has(folder.id)
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedFolderIds.add(folder.id)
        } else {
          selectedFolderIds.delete(folder.id)
        }
        render()
      })
      const name = element('span', folder.displayName, `folder-depth-${Math.min(folder.depth, 4)}`)
      label.append(checkbox, name)
      list.append(label)
    }
  }
  section.append(list)
  const scanButton = button(
    isBusy ? 'Scanning...' : 'Scan selected folders',
    'button button-primary',
    scanSelectedFolders
  )
  scanButton.disabled = isBusy || selectedFolderIds.size === 0
  section.append(scanButton)
  parent.append(section)
}

function renderCandidate(parent: HTMLElement, candidate: NewsletterCandidate): void {
  const card = element('article', undefined, 'newsletter-card')
  const top = element('div', undefined, 'newsletter-top')
  const titleGroup = element('div', undefined, 'newsletter-title-group')
  if (SELECTABLE_STATUSES.includes(candidate.status)) {
    const checkbox = element('input') as HTMLInputElement
    checkbox.type = 'checkbox'
    checkbox.disabled = isBusy
    checkbox.checked = selectedCandidateIds.has(candidate.id)
    checkbox.setAttribute('aria-label', `Select ${candidate.sender} for bulk unsubscribe`)
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedCandidateIds.add(candidate.id)
      } else {
        selectedCandidateIds.delete(candidate.id)
      }
      render()
    })
    titleGroup.append(checkbox)
  } else {
    titleGroup.append(element('span', undefined, 'checkbox-spacer'))
  }
  const titleBlock = element('div')
  titleBlock.append(
    element('h3', candidate.sender),
    element('p', candidate.subject, 'newsletter-subject')
  )
  titleBlock.title = candidate.sender
  titleGroup.append(
    element('span', getSenderDomain(candidate.sender).slice(0, 2).toUpperCase(), 'sender-avatar'),
    titleBlock
  )
  top.append(
    titleGroup,
    element('span', statusLabel(candidate.status), statusClass(candidate.status))
  )
  card.append(top)

  const details = element('p', undefined, 'newsletter-details')
  details.append(
    document.createTextNode(
      `${candidate.messageCount} message${candidate.messageCount === 1 ? '' : 's'} · `
    ),
    document.createTextNode(candidate.folderNames.join(', '))
  )
  card.append(details)

  if (skippedCandidates.has(candidate.id)) {
    card.append(element('p', skippedCandidates.get(candidate.id), 'skip-message'))
  }
  if (candidate.error) {
    card.append(element('p', candidate.error, 'error-message'))
  }

  const actions = element('div', undefined, 'newsletter-actions')
  if (candidate.status === 'unsubscribed') {
    actions.append(element('span', 'Request sent successfully.', 'success-message'))
  } else if (candidate.status === 'action-required') {
    actions.append(
      button('Mark as unsubscribed', 'button button-primary button-small', () =>
        markAsUnsubscribed(candidate.id)
      ),
      button('Open link again', 'button button-quiet button-small', () =>
        openUnsubscribeLink(candidate)
      )
    )
  } else {
    actions.append(
      button(
        candidate.status === 'failed' ? 'Try again' : 'Unsubscribe',
        'button button-primary button-small',
        () => unsubscribeFrom(candidate)
      )
    )
  }
  card.append(actions)
  parent.append(card)
}

function renderDashboard(parent: HTMLElement): void {
  const section = element('section', undefined, 'panel')
  const heading = element('div', undefined, 'panel-heading')
  heading.append(element('div', 'Your newsletters', 'panel-title'))
  heading.append(
    element(
      'div',
      state.lastScan
        ? `Last scan: ${formatDate(state.lastScan.scannedAt)}`
        : 'No scan completed yet.',
      'panel-description'
    )
  )
  section.append(heading)
  const controls = element('div', undefined, 'list-controls')
  const filters = element('div', undefined, 'filters')
  filters.setAttribute('aria-label', 'Filter newsletters')
  for (const [key, label] of [
    ['all', 'All newsletters'],
    ['found', 'Active'],
    ['unsubscribed', 'Unsubscribed'],
    ['action-required', 'Needs action'],
    ['failed', 'Failed']
  ]) {
    const tab = button(label, `filter ${activeFilter === key ? 'active' : ''}`, () => {
      activeFilter = key
      selectedCandidateIds.clear()
      render()
    })
    tab.setAttribute('aria-pressed', String(activeFilter === key))
    filters.append(tab)
  }
  const search = element('input', undefined, 'search-input')
  search.type = 'search'
  search.placeholder = 'Search newsletters…'
  search.setAttribute('aria-label', 'Search newsletters')
  search.value = searchQuery
  search.addEventListener('input', () => {
    searchQuery = search.value
    selectedCandidateIds.clear()
    const start = search.selectionStart
    const end = search.selectionEnd
    render()
    const replacement = app.querySelector<HTMLInputElement>('.search-input')
    replacement?.focus()
    replacement?.setSelectionRange(start, end)
  })
  controls.append(filters, search)
  section.append(controls)
  if (state.candidates.length > 0)
    section.append(
      element(
        'p',
        'Bulk unsubscribe pauses a sender domain after a failed request, including existing failures. Other domains continue. You can retry a newsletter individually.',
        'bulk-policy'
      )
    )
  const visible = state.candidates.filter(
    (item) =>
      (activeFilter === 'all' || item.status === activeFilter) &&
      `${item.sender} ${item.subject}`.toLowerCase().includes(searchQuery.toLowerCase())
  )
  if (state.candidates.length === 0) {
    const empty = element('div', undefined, 'empty-state')
    empty.append(
      icon('mail'),
      element('h3', 'A fresh start for your inbox'),
      element('p', 'Scan your mail folders to find newsletters and choose what stays.'),
      button('Choose folders →', 'button button-primary', () => {
        activeView = 'folders'
        render()
      })
    )
    section.append(empty)
  } else {
    const selectableCount = visible.filter((item) =>
      SELECTABLE_STATUSES.includes(item.status)
    ).length
    const toolbar = element('div', undefined, 'toolbar selection-toolbar')
    toolbar.append(
      button('Select all', 'button button-quiet button-small', () => {
        selectedCandidateIds = new Set(
          visible.filter((item) => SELECTABLE_STATUSES.includes(item.status)).map((item) => item.id)
        )
        render()
      }),
      button('Clear selection', 'button button-quiet button-small', () => {
        selectedCandidateIds.clear()
        render()
      }),
      button(
        isBusy ? 'Working…' : `Unsubscribe (${selectedCandidateIds.size})`,
        'button button-primary button-small',
        unsubscribeSelected
      )
    )
    const bulkButton = toolbar.lastElementChild as HTMLButtonElement
    bulkButton.disabled = isBusy || selectedCandidateIds.size === 0
    if (selectedCandidateIds.size === 0) {
      toolbar.children[1].remove()
      bulkButton.remove()
      toolbar.append(element('span', `${visible.length} newsletters`, 'muted'))
    }
    if (selectableCount > 0) {
      section.append(toolbar)
    }
    const list = element('div', undefined, 'newsletter-list')
    for (const candidate of visible) {
      renderCandidate(list, candidate)
    }
    if (visible.length === 0)
      list.append(element('p', 'No newsletters match your search or filter.', 'empty-state'))
    section.append(list)
  }
  const footer = element('div', undefined, 'dashboard-footer')
  footer.append(
    element(
      'span',
      state.lastScan
        ? `${state.lastScan.messageCount.toLocaleString()} messages checked.`
        : 'Results stay on this device only.',
      'muted'
    ),
    button('Clear dashboard', 'button button-quiet', () => {
      clearState()
      state = { candidates: [] }
      selectedCandidateIds.clear()
      statusMessage = 'Dashboard cleared.'
      render()
    })
  )
  section.append(footer)
  parent.append(section)
}

interface DomainSummaryRow {
  domain: string
  lists: number
  messageCount: number
  unsubscribed: number
  unsubscribedMessages: number
  failed: number
  actionRequired: number
}

function buildDomainSummary(candidates: NewsletterCandidate[]): DomainSummaryRow[] {
  const rows = new Map<string, DomainSummaryRow>()
  for (const candidate of candidates) {
    const domain = getSenderDomain(candidate.sender)
    const row = rows.get(domain) ?? {
      domain,
      lists: 0,
      messageCount: 0,
      unsubscribed: 0,
      unsubscribedMessages: 0,
      failed: 0,
      actionRequired: 0
    }
    row.lists += 1
    row.messageCount += candidate.messageCount
    if (candidate.status === 'unsubscribed') {
      row.unsubscribed += 1
      row.unsubscribedMessages += candidate.messageCount
    } else if (candidate.status === 'failed') {
      row.failed += 1
    } else if (candidate.status === 'action-required') {
      row.actionRequired += 1
    }
    rows.set(domain, row)
  }
  return [...rows.values()].sort((left, right) => right.messageCount - left.messageCount)
}

function renderDomainSummary(parent: HTMLElement): void {
  if (state.candidates.length === 0) {
    parent.append(
      element(
        'div',
        'Scan your folders to see which domains send you the most newsletters.',
        'panel empty-state'
      )
    )
    return
  }
  const rows = buildDomainSummary(state.candidates)
  const section = element('section', undefined, 'panel')
  const heading = element('div', undefined, 'panel-heading')
  heading.append(element('div', 'Domain summary', 'panel-title'))
  const totalUnsubscribedMessages = rows.reduce((sum, row) => sum + row.unsubscribedMessages, 0)
  const unsubscribedDomains = rows.filter((row) => row.unsubscribed > 0).length
  heading.append(
    element(
      'div',
      `${totalUnsubscribedMessages.toLocaleString()} scanned message${totalUnsubscribedMessages === 1 ? '' : 's'} from unsubscribed lists across ${unsubscribedDomains} domain${unsubscribedDomains === 1 ? '' : 's'}.`,
      'panel-description'
    )
  )
  section.append(heading)

  const table = element('table', undefined, 'domain-table')
  const head = element('tr')
  head.append(
    element('th', 'Domain'),
    element('th', 'Mails found'),
    element('th', 'Unsubscribed'),
    element('th', 'Failed'),
    element('th', 'Action required')
  )
  const thead = element('thead')
  thead.append(head)
  table.append(thead)

  const tbody = element('tbody')
  for (const row of rows) {
    const tr = element('tr')
    tr.append(
      element('td', row.domain),
      element(
        'td',
        `${row.messageCount.toLocaleString()} (${row.lists} list${row.lists === 1 ? '' : 's'})`
      ),
      element(
        'td',
        row.unsubscribed > 0 ? `${row.unsubscribedMessages.toLocaleString()} mails` : '—'
      ),
      element('td', row.failed > 0 ? String(row.failed) : '—'),
      element('td', row.actionRequired > 0 ? String(row.actionRequired) : '—')
    )
    tbody.append(tr)
  }
  table.append(tbody)
  section.append(table)
  parent.append(section)
}

function renderActivity(parent: HTMLElement): void {
  const expanded = new Set(
    [...parent.querySelectorAll<HTMLDetailsElement>('details[open]')].map((node) => node.dataset.id)
  )
  parent.replaceChildren()
  const section = element('section', undefined, 'activity-panel')
  const heading = element('div', undefined, 'panel-heading')
  heading.append(element('div', 'Recent activity', 'panel-title'))
  const clear = button('Clear completed', 'button button-quiet button-small', () => {
    void window.api.activity.clear().catch(() => {
      statusMessage = 'Activity could not be cleared.'
      render()
    })
  })
  clear.disabled = !activityEntries.some((entry) => entry.status !== 'pending')
  heading.append(clear)
  section.append(
    heading,
    element(
      'p',
      'Latest 200 steps from this app session. Private links, account tokens, and email contents are not recorded.',
      'panel-description'
    )
  )
  if (activityEntries.length === 0)
    section.append(
      element(
        'p',
        'Nothing here yet. Connecting your account, scanning folders, or unsubscribing will show activity here.',
        'empty-state'
      )
    )
  const list = element('div', undefined, 'activity-list')
  for (const entry of activityEntries) {
    const row = element('article', undefined, 'activity-row')
    const top = element('div', undefined, 'activity-top')
    top.append(
      element('h3', entry.title),
      element(
        'span',
        {
          pending: 'In progress',
          success: 'Completed',
          failed: 'Couldn’t complete',
          'action-required': 'Your next step'
        }[entry.status],
        `status activity-${entry.status}`
      )
    )
    const time = element(
      'time',
      new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).format(new Date(entry.startedAt))
    )
    time.dateTime = entry.startedAt
    row.append(top, element('p', entry.detail, 'activity-description'))
    const meta = element('div', undefined, 'activity-meta')
    meta.append(time, element('span', entry.destination))
    row.append(meta)
    const details = element('details', undefined, 'activity-details')
    details.dataset.id = entry.id
    details.open = expanded.has(entry.id)
    details.append(element('summary', 'Request details'))
    const facts = element('dl')
    for (const [label, value] of [
      ['Type', entry.method],
      ['Destination', entry.destination],
      ['Started', formatDate(entry.startedAt)],
      [
        'Time taken',
        entry.durationMs === undefined
          ? 'Still in progress'
          : `${(entry.durationMs / 1000).toFixed(1)} seconds`
      ]
    ]) {
      facts.append(element('dt', label), element('dd', value))
    }
    if (entry.method === 'POST') {
      facts.append(
        element('dt', 'Content type'),
        element('dd', entry.contentType ?? 'Not recorded')
      )
      facts.append(element('dt', 'POST body'))
      const body = element('dd')
      body.append(element('code', entry.requestBody ?? 'Not recorded for this request.'))
      facts.append(body)
    }
    details.append(facts)
    row.append(details)
    list.append(row)
  }
  section.append(list)
  parent.append(section)
}

function render(): void {
  app.replaceChildren()
  selectedCandidateIds = new Set(
    [...selectedCandidateIds].filter((id) =>
      state.candidates.some((item) => item.id === id && SELECTABLE_STATUSES.includes(item.status))
    )
  )
  const shell = element('div', undefined, 'shell')
  if (!account) {
    renderSignIn(shell)
    app.append(shell)
    return
  }
  const sidebar = element('aside', undefined, 'sidebar')
  sidebar.append(brand(), element('p', 'WORKSPACE', 'nav-label'))
  const nav = element('nav', undefined, 'navigation')
  for (const [key, glyph, label] of [
    ['newsletters', 'mail', 'Newsletters'],
    ['folders', 'folders', 'Mail folders'],
    ['insights', 'insights', 'Insights'],
    ['activity', 'activity', 'Activity']
  ] as const) {
    const item = button('', `nav-item ${activeView === key ? 'active' : ''}`, () => {
      activeView = key
      render()
    })
    item.append(icon(glyph), element('span', label))
    if (activeView === key) item.setAttribute('aria-current', 'page')
    if (key === 'newsletters')
      item.append(element('span', String(state.candidates.length), 'nav-count'))
    nav.append(item)
  }
  sidebar.append(nav)
  const note = element('div', undefined, 'sidebar-note')
  note.append(
    icon('shield'),
    element('span', 'Stored on this Mac', 'note-title'),
    element('p', 'Your newsletter history is private to this device.')
  )
  const profile = element('div', undefined, 'account-badge')
  const details = element('div', undefined, 'account-details')
  details.append(
    element('strong', account.name ?? account.username),
    element('span', account.username)
  )
  profile.append(
    element('span', (account.name ?? account.username).slice(0, 1).toUpperCase(), 'profile-avatar'),
    details,
    button('Sign out', 'sign-out', signOut)
  )
  sidebar.append(note, profile)
  const main = element('main', undefined, 'main-content')
  const header = element('header', undefined, 'app-header')
  const title = element('div')
  title.append(
    element('p', 'WORKSPACE / ' + activeView.toUpperCase(), 'eyebrow'),
    element(
      'h1',
      activeView === 'newsletters'
        ? 'Newsletters'
        : activeView === 'folders'
          ? 'Mail folders'
          : activeView === 'activity'
            ? 'Activity'
            : 'Insights'
    ),
    element(
      'p',
      activeView === 'newsletters'
        ? 'Keep what you love. Clear out the rest.'
        : activeView === 'folders'
          ? 'Choose where to look. We’ll find the newsletters.'
          : activeView === 'activity'
            ? 'See what the app is doing, one step at a time.'
            : 'Understand where your newsletter traffic comes from.',
      'page-description'
    )
  )
  header.append(
    title,
    button('Scan mailbox', 'button button-primary', () => {
      activeView = 'folders'
      render()
    })
  )
  header.querySelector('button')?.prepend(icon('scan'))
  main.append(header)
  if (activeView === 'newsletters') renderStats(main)
  const status = element('p', statusMessage, `status-message ${isBusy ? 'is-busy' : ''}`)
  status.setAttribute('role', 'status')
  main.append(status)
  if (activeView === 'folders') renderFolderPicker(main)
  else if (activeView === 'insights') renderDomainSummary(main)
  else if (activeView === 'activity') {
    const activityContent = element('div')
    activityContent.id = 'activity-content'
    renderActivity(activityContent)
    main.append(activityContent)
  } else renderDashboard(main)
  const footer = element('footer', undefined, 'app-footer')
  footer.append(
    element('span', 'Microsoft 365 · Read-only mailbox access'),
    element(
      'span',
      state.lastScan ? `Updated ${formatDate(state.lastScan.scannedAt)}` : 'Ready when you are'
    )
  )
  main.append(footer)
  shell.append(sidebar, main)
  app.append(shell)
}

async function startSignIn(): Promise<void> {
  if (isBusy) {
    return
  }
  isBusy = true
  statusMessage = 'Waiting for sign-in...'
  const stopListening = window.api.auth.onDeviceCode((info) => {
    deviceCode = info
    render()
  })
  render()
  try {
    account = await window.api.auth.login()
    deviceCode = null
    statusMessage = `Signed in as ${account.username}.`
    await refreshFolders()
  } catch (error) {
    deviceCode = null
    statusMessage = error instanceof Error ? error.message : 'Sign-in failed.'
  } finally {
    stopListening()
    isBusy = false
    render()
  }
}

async function signOut(): Promise<void> {
  if (isBusy) {
    return
  }
  isBusy = true
  try {
    await window.api.auth.logout()
    clearState()
    state = { candidates: [] }
    selectedCandidateIds.clear()
    skippedCandidates.clear()

    account = null
    folders = []
    selectedFolderIds.clear()
    statusMessage = 'Signed out.'
  } catch {
    statusMessage = 'Sign-out could not be completed. Please try again.'
  } finally {
    isBusy = false
    render()
  }
}

async function refreshFolders(): Promise<void> {
  if (isBusy && folders.length > 0) {
    return
  }
  isBusy = true
  statusMessage = 'Loading mailbox folders...'
  render()
  try {
    folders = await window.api.mail.listFolders()
    selectedFolderIds = new Set(
      folders.filter(({ id }) => selectedFolderIds.has(id)).map(({ id }) => id)
    )
    statusMessage = `${folders.length} mail folder${folders.length === 1 ? '' : 's'} available.`
  } catch (error) {
    statusMessage = error instanceof Error ? error.message : 'Folders could not be loaded.'
  } finally {
    isBusy = false
    render()
  }
}

async function scanSelectedFolders(): Promise<void> {
  const selected = folders.filter(({ id }) => selectedFolderIds.has(id))
  if (selected.length === 0 || isBusy) {
    return
  }
  isBusy = true
  statusMessage = 'Starting scan...'
  render()
  const stopListening = window.api.mail.onScanProgress((progress) => {
    statusMessage = progress
    render()
  })
  try {
    const scan = await window.api.mail.scan(selected)
    activeView = 'newsletters'
    state = {
      candidates: mergeScanWithHistory(scan, state.candidates),
      lastScan: scan
    }
    saveState(state)
    statusMessage = `Scan complete: ${scan.candidates.length} newsletter${scan.candidates.length === 1 ? '' : 's'} found.`
  } catch (error) {
    statusMessage = error instanceof Error ? error.message : 'The mailbox scan failed.'
  } finally {
    stopListening()
    isBusy = false
    render()
  }
}

async function unsubscribeFrom(candidate: NewsletterCandidate): Promise<void> {
  if (isBusy) {
    return
  }
  skippedCandidates.delete(candidate.id)
  isBusy = true
  statusMessage = `Unsubscribing from ${candidate.sender}...`
  render()
  try {
    const outcome = await window.api.mail.unsubscribe(candidate)
    state = {
      ...state,
      candidates: state.candidates.map((item) =>
        item.id === candidate.id
          ? {
              ...item,
              status: outcome.status,
              error: outcome.error,
              requestFailed: outcome.requestFailed,
              updatedAt: new Date().toISOString()
            }
          : item
      )
    }
    saveState(state)
    statusMessage =
      outcome.status === 'unsubscribed'
        ? `${candidate.sender} was unsubscribed.`
        : (outcome.error ?? 'Further action is required.')
  } catch (error) {
    statusMessage = error instanceof Error ? error.message : 'Unsubscribe failed. Please try again.'
  } finally {
    isBusy = false
    render()
  }
}

async function unsubscribeSelected(): Promise<void> {
  const selected = state.candidates.filter(
    (item) => selectedCandidateIds.has(item.id) && SELECTABLE_STATUSES.includes(item.status)
  )
  if (selected.length === 0 || isBusy) return
  isBusy = true
  skippedCandidates.clear()
  let unsubscribedCount = 0
  let actionRequiredCount = 0
  let failedCount = 0
  let skippedCount = 0
  const skippedDomains = new Set<string>()
  try {
    await runDomainBatch(
      selected,
      state.candidates,
      async (candidate) => {
        statusMessage = `Unsubscribing from ${candidate.sender} (${unsubscribedCount + actionRequiredCount + failedCount + skippedCount + 1}/${selected.length})…`
        render()
        return window.api.mail.unsubscribe(candidate)
      },
      (candidate, outcome) => {
        if (outcome.status === 'unsubscribed') unsubscribedCount++
        else if (outcome.status === 'action-required') actionRequiredCount++
        else failedCount++
        state = {
          ...state,
          candidates: state.candidates.map((item) =>
            item.id === candidate.id
              ? {
                  ...item,
                  status: outcome.status,
                  error: outcome.error,
                  requestFailed: outcome.requestFailed,
                  updatedAt: new Date().toISOString()
                }
              : item
          )
        }
        saveState(state)
        selectedCandidateIds.delete(candidate.id)
      },
      (candidate, domain) => {
        skippedCount++
        skippedDomains.add(domain)
        skippedCandidates.set(
          candidate.id,
          `Skipped in bulk: a request from ${domain} failed. No request was sent for this newsletter in this batch. You can try it individually.`
        )
        selectedCandidateIds.delete(candidate.id)
      }
    )
    statusMessage = `Bulk unsubscribe finished: ${unsubscribedCount} unsubscribed, ${actionRequiredCount} need action, ${failedCount} failed, ${skippedCount} skipped.`
    if (skippedDomains.size)
      statusMessage += ` Paused domains: ${[...skippedDomains].join(', ')}. Retry newsletters individually to resolve failures.`
  } finally {
    isBusy = false
    render()
  }
}

function markAsUnsubscribed(id: string): void {
  skippedCandidates.delete(id)
  state = {
    ...state,
    candidates: state.candidates.map((item) =>
      item.id === id
        ? {
            ...item,
            status: 'unsubscribed',
            error: undefined,
            requestFailed: false,
            updatedAt: new Date().toISOString()
          }
        : item
    )
  }
  saveState(state)
  statusMessage = 'Newsletter marked as unsubscribed.'
  render()
}

function openUnsubscribeLink(candidate: NewsletterCandidate): void {
  const link = candidate.unsubscribeUrls[0]
  if (!link) {
    statusMessage = 'No unsubscribe link is available.'
    render()
    return
  }
  // Intercepted by the main process's window-open handler and opened in the system browser.
  window.open(link, '_blank', 'noopener,noreferrer')
  statusMessage = 'Complete the unsubscribe action in your browser, then mark it as unsubscribed.'
  render()
}

async function init(): Promise<void> {
  const stopActivity = window.api.activity.onUpdated((entries) => {
    activityEntries = entries
    const content = app.querySelector<HTMLElement>('#activity-content')
    if (content) renderActivity(content)
  })
  window.addEventListener('beforeunload', stopActivity, { once: true })
  render()
  try {
    activityEntries = await window.api.activity.list()
  } catch {
    statusMessage = 'Activity could not be loaded.'
  }
  try {
    account = await window.api.auth.getAccount()
    if (account) {
      statusMessage = `Signed in as ${account.username}.`
      await refreshFolders()
    }
  } catch (error) {
    statusMessage = error instanceof Error ? error.message : 'Could not restore your sign-in.'
  } finally {
    render()
  }
}

void init()
