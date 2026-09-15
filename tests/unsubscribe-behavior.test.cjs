/* Plain Node test harness compiles isolated TypeScript modules without Electron. */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./helpers.cjs')

const { runDomainBatch } = load('src/renderer/src/bulk.ts')
const candidate = (id, domain, extra = {}) => ({
  id,
  sender: `${id}@${domain}`,
  status: 'found',
  ...extra
})

async function batch(selected, history, reply) {
  const sent = [],
    skipped = [],
    outcomes = []
  await runDomainBatch(
    selected,
    history,
    async (item) => {
      sent.push(item.id)
      return reply(item)
    },
    (item, outcome) => outcomes.push([item.id, outcome.status]),
    (item) => skipped.push(item.id)
  )
  return { sent, skipped, outcomes }
}

test('stops the failed sender domain but continues unrelated and subdomains', async () => {
  const rows = [
    candidate('a', 'EXAMPLE.com'),
    candidate('b', 'example.com'),
    candidate('c', 'other.com'),
    candidate('d', 'news.example.com')
  ]
  const result = await batch(rows, [], (item) => ({
    status: item.id === 'a' ? 'failed' : 'unsubscribed'
  }))
  assert.deepEqual(result.sent, ['a', 'c', 'd'])
  assert.deepEqual(result.skipped, ['b'])
})

test('existing failures block the domain even when the failed row is not selected', async () => {
  const result = await batch(
    [candidate('b', 'example.com')],
    [candidate('a', 'example.com', { status: 'failed' })],
    () => ({ status: 'unsubscribed' })
  )
  assert.deepEqual(result.sent, [])
  assert.deepEqual(result.skipped, ['b'])
})

test('browser fallback after request failure pauses the domain', async () => {
  const result = await batch(
    [candidate('a', 'example.com'), candidate('b', 'example.com')],
    [],
    () => ({ status: 'action-required', requestFailed: true })
  )
  assert.deepEqual(result.sent, ['a'])
  assert.deepEqual(result.skipped, ['b'])
})

test('manual action without request failure does not pause the domain', async () => {
  const result = await batch(
    [candidate('a', 'example.com'), candidate('b', 'example.com')],
    [],
    () => ({ status: 'action-required' })
  )
  assert.deepEqual(result.sent, ['a', 'b'])
})

test('exceptions pause their domain and other domains continue', async () => {
  const result = await batch(
    [candidate('a', 'example.com'), candidate('b', 'example.com'), candidate('c', 'other.com')],
    [],
    (item) => {
      if (item.id === 'a') throw Error('offline')
      return { status: 'unsubscribed' }
    }
  )
  assert.deepEqual(result.sent, ['a', 'c'])
  assert.deepEqual(result.outcomes, [
    ['a', 'failed'],
    ['c', 'unsubscribed']
  ])
})

test('resolved failure does not block future bulk requests', async () => {
  const result = await batch(
    [candidate('b', 'example.com')],
    [candidate('a', 'example.com', { status: 'unsubscribed', requestFailed: false })],
    () => ({ status: 'unsubscribed' })
  )
  assert.deepEqual(result.sent, ['b'])
})

test('request details contain the actual one-click POST body and never arbitrary secrets', async () => {
  const sent = []
  const activity = load(
    'src/main/activity.ts',
    {
      fetch: async (_url, init) => {
        sent.push(init.body)
        return { ok: true, status: 200 }
      }
    },
    {
      './network': {
        publicPost: async (_url, body) => {
          sent.push(body)
          return { ok: true, status: 200 }
        }
      }
    }
  )
  await activity.activityFetch(
    'https://example.com/private?token=secret',
    { method: 'POST', body: 'List-Unsubscribe=One-Click' },
    'Unsubscribe',
    'example.com'
  )
  assert.equal(activity.getActivity()[0].requestBody, sent[0])
  assert.equal(activity.getActivity()[0].contentType, 'application/x-www-form-urlencoded')
  await activity.activityFetch(
    'https://example.com',
    { method: 'POST', body: 'password=secret' },
    'Request',
    'example.com'
  )
  assert.equal(activity.getActivity()[0].requestBody, undefined)
  assert.ok(!JSON.stringify(activity.getActivity()).includes('secret'))
})
