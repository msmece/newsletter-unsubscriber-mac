/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./helpers.cjs')

const older = '2026-10-01T12:00:00Z'
const newer = '2026-10-13T12:00:00Z'
const acceptedAt = '2026-10-02T12:00:00Z'

function message(url, options = {}) {
  return {
    subject: options.subject ?? 'Synthetic newsletter',
    from: { emailAddress: { address: 'news@example.com' } },
    receivedDateTime: options.date ?? older,
    internetMessageHeaders: [
      {
        name: 'List-Unsubscribe',
        value: `<${url}>${options.extraUrl ? `, <${options.extraUrl}>` : ''}`
      },
      ...(options.listId === false
        ? []
        : [{ name: 'List-ID', value: options.listId ?? 'Weekly news <weekly.example.com>' }]),
      ...(options.post === undefined
        ? []
        : [{ name: 'List-Unsubscribe-Post', value: options.post }])
    ]
  }
}

async function scan(messages) {
  const { scanFolders } = load(
    'src/main/graph.ts',
    {},
    {
      './auth': { getAccessToken: async () => 'synthetic-token' },
      './config': { GRAPH_BASE_URL: 'https://graph.microsoft.com/v1.0' },
      './activity': {
        activityFetch: async () => ({ ok: true, json: async () => ({ value: messages }) })
      }
    }
  )
  return scanFolders([{ id: 'synthetic-folder', displayName: 'Inbox', depth: 0 }], () => {})
}

function transport(reply, open = async () => {}) {
  const posts = [],
    opened = []
  const { unsubscribe } = load(
    'src/main/unsubscribe.ts',
    {},
    {
      './activity': {
        activityFetch: async (url, init) => {
          posts.push(url)
          assert.equal(init.method, 'POST')
          assert.equal(init.body, 'List-Unsubscribe=One-Click')
          return reply(url)
        },
        openExternalWithActivity: async (url) => {
          opened.push(url)
          await open(url)
        },
        serviceDestination: () => 'example.com'
      }
    }
  )
  return { unsubscribe, posts, opened }
}

function row(links) {
  return {
    id: 'news@example.com|weekly.example.com',
    sender: 'news@example.com',
    subject: 'Synthetic newsletter',
    listId: 'weekly.example.com',
    unsubscribeUrls: links.map((link) => link.url),
    unsubscribeLinks: links,
    oneClick: links.some((link) => link.oneClick),
    messageCount: 1,
    folderNames: ['Inbox'],
    firstSeen: older,
    lastSeen: older,
    status: 'found',
    updatedAt: older
  }
}
const link = (url, date = older, oneClick = true) => ({ url, receivedAt: date, oneClick })

test('mixed messages POST only to the URL whose message advertised one-click', async () => {
  const result = await scan([
    message('https://example.com/manual', { date: newer }),
    message('https://example.com/automatic', { post: 'List-Unsubscribe=One-Click' })
  ])
  assert.equal(result.candidates.length, 1)
  const service = transport(async () => ({ ok: true, status: 200 }))
  const outcome = await service.unsubscribe(result.candidates[0])
  assert.equal(outcome.status, 'unsubscribed')
  assert.deepEqual(service.posts, ['https://example.com/automatic'])
  assert.deepEqual(service.opened, [])
})

test('newest advertised endpoint wins regardless of message traversal order', async () => {
  for (const reverse of [false, true]) {
    const messages = [
      message('https://example.com/old', { post: 'List-Unsubscribe=One-Click' }),
      message('https://example.com/new', {
        post: 'List-Unsubscribe=One-Click',
        date: newer,
        subject: 'Newest issue'
      })
    ]
    const result = await scan(reverse ? messages.reverse() : messages)
    const candidate = result.candidates[0]
    assert.equal(candidate.subject, 'Newest issue')
    assert.equal(candidate.firstSeen, older)
    assert.equal(candidate.lastSeen, newer)
    const service = transport(async () => ({ ok: true, status: 204 }))
    await service.unsubscribe(candidate)
    assert.deepEqual(service.posts, ['https://example.com/new'])
  }
})

test('newer manual metadata for the same URL revokes old one-click eligibility', async () => {
  const result = await scan([
    message('HTTPS://EXAMPLE.COM/same', { post: 'List-Unsubscribe=One-Click' }),
    message('https://example.com/same', { date: newer })
  ])
  const service = transport(async () => {
    throw Error('must not POST')
  })
  assert.equal((await service.unsubscribe(result.candidates[0])).status, 'action-required')
  assert.deepEqual(service.posts, [])
})

test('legacy aggregate one-click flags never authorize an automatic POST', async () => {
  const service = transport(async () => {
    throw Error('must not POST')
  })
  const candidate = row([link('https://example.com/manual')])
  delete candidate.unsubscribeLinks
  assert.equal((await service.unsubscribe(candidate)).status, 'action-required')
  assert.deepEqual(service.posts, [])
})

test('expired and unreachable endpoints fall through to a usable automatic alternative', async () => {
  for (const fail of [
    async () => ({ ok: false, status: 410 }),
    async () => {
      throw Error('connection failure')
    }
  ]) {
    const service = transport(async (url) =>
      url.endsWith('/valid') ? { ok: true, status: 200 } : fail()
    )
    const outcome = await service.unsubscribe(
      row([link('https://example.com/expired', newer), link('https://example.com/valid')])
    )
    assert.equal(outcome.status, 'unsubscribed')
    assert.equal(outcome.requestFailed, true)
    assert.deepEqual(service.posts, ['https://example.com/expired', 'https://example.com/valid'])
    assert.deepEqual(service.opened, [])
  }
})

test('rate limiting stops further automatic alternatives', async () => {
  const service = transport(async () => ({ ok: false, status: 429 }))
  const outcome = await service.unsubscribe(
    row([link('https://example.com/new', newer), link('https://example.com/old')])
  )
  assert.equal(outcome.status, 'action-required')
  assert.equal(outcome.requestFailed, true)
  assert.equal(service.posts.length, 1)
})

test('HTTP failures and exceptions retain domain blocking through an email fallback', async () => {
  for (const fail of [
    async () => ({ ok: false, status: 429 }),
    async () => {
      throw Error('offline')
    }
  ]) {
    const service = transport(fail, async (url) => {
      if (url.startsWith('https:')) throw Error('browser unavailable')
    })
    const outcome = await service.unsubscribe(
      row([
        link('https://example.com/failed'),
        link('mailto:unsubscribe@example.com', older, false)
      ])
    )
    assert.equal(outcome.status, 'action-required')
    assert.equal(outcome.requestFailed, true)
    assert.equal(outcome.manualUrl, 'mailto:unsubscribe@example.com')
    assert.ok(service.opened.includes('mailto:unsubscribe@example.com'))
  }
})

test('email alternatives continue when the first mail handler fails', async () => {
  const service = transport(
    async () => {
      throw Error('must not POST')
    },
    async (url) => {
      if (url.includes('first@')) throw Error('cannot open first')
    }
  )
  const outcome = await service.unsubscribe(
    row([
      link('mailto:first@example.com', newer, false),
      link('mailto:second@example.com', older, false)
    ])
  )
  assert.equal(outcome.status, 'action-required')
  assert.equal(outcome.requestFailed, false)
  assert.equal(outcome.manualUrl, 'mailto:second@example.com')
})

test('URL token case remains distinct while scheme and hostname are normalized', async () => {
  const result = await scan([
    message('HTTPS://EXAMPLE.COM/u?token=ABC', {
      listId: false,
      post: 'List-Unsubscribe=One-Click'
    }),
    message('https://example.com/u?token=abc', {
      listId: false,
      post: 'List-Unsubscribe=One-Click'
    })
  ])
  assert.equal(result.candidates.length, 2)
  assert.notEqual(result.candidates[0].id, result.candidates[1].id)
})

test('malformed one-click values and ambiguous HTTPS targets remain manual', async () => {
  for (const options of [
    { post: 'List-Unsubscribe=One-Click-extra' },
    { post: 'prefix List-Unsubscribe=One-Click' },
    { post: 'List-Unsubscribe=One-Click', extraUrl: 'https://example.com/other' }
  ]) {
    const result = await scan([message('https://example.com/unsubscribe', options)])
    const service = transport(async () => {
      throw Error('must not POST')
    })
    assert.equal((await service.unsubscribe(result.candidates[0])).status, 'action-required')
    assert.deepEqual(service.posts, [])
  }
})

test('list display names do not split the same List-ID', async () => {
  const result = await scan([
    message('https://example.com/first', { listId: 'First title <weekly.example.com>' }),
    message('https://example.com/second', { listId: 'New title <WEEKLY.EXAMPLE.COM>' })
  ])
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].messageCount, 2)
})

test('rescan reopens completed entries only when delivery is newer than completion', async () => {
  const { mergeScanWithHistory } = load('src/renderer/src/storage.ts')
  for (const completion of ['request', 'manual']) {
    const previous = {
      ...row([link('https://example.com/old')]),
      status: 'unsubscribed',
      completion,
      updatedAt: acceptedAt
    }
    const current = await scan([
      message('https://example.com/new', { date: newer, post: 'List-Unsubscribe=One-Click' })
    ])
    const reopened = mergeScanWithHistory(current, [previous])[0]
    assert.equal(reopened.status, 'found')
    assert.equal(reopened.completion, undefined)
    assert.match(reopened.error, /New mail arrived/)
    assert.equal(reopened.unsubscribeLinks[0].url, 'https://example.com/new')
    const oldScan = await scan([message('https://example.com/old')])
    const retained = mergeScanWithHistory(oldScan, [previous])[0]
    assert.equal(retained.status, 'unsubscribed')
    assert.equal(retained.completion, completion)
    assert.equal(retained.updatedAt, acceptedAt)
  }
})

test('partial and empty rescans preserve failures and completion history', async () => {
  const { mergeScanWithHistory } = load('src/renderer/src/storage.ts')
  const failed = {
    ...row([link('https://example.com/failed')]),
    status: 'failed',
    requestFailed: true
  }
  const completed = {
    ...row([link('https://example.com/done')]),
    sender: 'other@example.org',
    id: 'other@example.org|weekly.example.com',
    status: 'unsubscribed'
  }
  const fresh = await scan([
    message('https://example.com/new', { listId: 'different.example.com' })
  ])
  const combined = mergeScanWithHistory(fresh, [failed, completed])
  assert.equal(combined.length, 3)
  assert.equal(combined.find((item) => item.status === 'failed').requestFailed, true)
  assert.equal(mergeScanWithHistory({ candidates: [] }, combined).length, 3)
})

test('legacy URL identities migrate without losing recorded completion', async () => {
  const legacy = {
    ...row([link('https://example.com/u?token=ABC')]),
    listId: undefined,
    id: 'news@example.com|https://example.com/u?token=abc',
    status: 'unsubscribed',
    updatedAt: acceptedAt
  }
  delete legacy.unsubscribeLinks
  const { loadState, mergeScanWithHistory } = load('src/renderer/src/storage.ts', {
    window: {
      localStorage: {
        getItem: (key) =>
          key === 'newsletter-unsubscriber:v1' ? JSON.stringify({ candidates: [legacy] }) : null,
        removeItem: () => {}
      },
      api: {
        history: {
          load: async () => ({
            state: { candidates: [] },
            mode: 'encrypted',
            locked: false,
            hasSavedHistory: false
          }),
          save: async () => ({ mode: 'encrypted', locked: false, hasSavedHistory: true }),
          purgeLegacy: async () => {}
        }
      }
    }
  })
  const saved = (await loadState()).candidates[0]
  assert.equal(saved.id, 'news@example.com|https://example.com/u?token=ABC')
  const current = await scan([
    message('https://example.com/u?token=ABC', {
      listId: false,
      post: 'List-Unsubscribe=One-Click'
    })
  ])
  const merged = mergeScanWithHistory(current, [saved])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].status, 'unsubscribed')
  assert.equal(merged[0].unsubscribeLinks[0].oneClick, true)
})

test('large lists remain valid IPC candidates and use the newest link', async () => {
  const result = await scan(
    Array.from({ length: 501 }, (_, index) =>
      message(`https://example.com/u?token=${index}`, {
        date: new Date(Date.parse(older) + index * 1000).toISOString(),
        post: 'List-Unsubscribe=One-Click'
      })
    )
  )
  const { validateCandidate } = load('src/main/validation.ts')
  validateCandidate(result.candidates[0])
  const service = transport(async () => ({ ok: true, status: 200 }))
  await service.unsubscribe(result.candidates[0])
  assert.deepEqual(service.posts, ['https://example.com/u?token=500'])
})

test('IPC rejects malformed or unrelated per-message link metadata', () => {
  const { validateCandidate } = load('src/main/validation.ts')
  const candidate = row([link('https://example.com/u')])
  validateCandidate(candidate)
  for (const unsubscribeLinks of [
    null,
    {},
    [null],
    [{ url: 'https://example.com/u', oneClick: 'true', receivedAt: older }],
    [link('https://example.com/unrelated')]
  ]) {
    assert.throws(() => validateCandidate({ ...candidate, unsubscribeLinks }))
  }
})
