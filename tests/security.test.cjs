/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./helpers.cjs')
const { isPublicAddress, externalUrl, publicPost } = load('src/main/network.ts')
const { validateCandidate, validateFolders } = load('src/main/validation.ts')

test('blocks local, private, reserved, mapped and malformed IP addresses', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.1.1',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
    'invalid'
  ])
    assert.equal(isPublicAddress(address), false, address)
  assert.equal(isPublicAddress('8.8.8.8'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
})

test('external URLs reject unsafe protocols, credentials, and local destinations', () => {
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://example.com',
    'https://user:pass@example.com',
    'https://127.1/',
    'https://[::1]/',
    'https://localhost/',
    'https://device.local/'
  ])
    assert.throws(() => externalUrl(url), undefined, url)
  assert.equal(
    externalUrl('https://example.com/unsubscribe?token=synthetic').hostname,
    'example.com'
  )
  assert.equal(externalUrl('mailto:unsubscribe@example.com').protocol, 'mailto:')
})

test('automatic POST rejects nonstandard ports before opening a connection', () => {
  assert.throws(() => publicPost('https://example.com:8443/', 'List-Unsubscribe=One-Click'))
})

test('invalid IPC shapes are rejected', () => {
  for (const value of [
    null,
    {},
    'folder',
    [{ id: 3 }],
    [{ id: 'x', displayName: 'Inbox', depth: -1 }]
  ])
    assert.throws(() => validateFolders(value))
  validateFolders([{ id: 'x', displayName: 'Inbox', depth: 0 }])
  for (const value of [null, {}, { unsubscribeUrls: 'https://example.com' }])
    assert.throws(() => validateCandidate(value))
})

test('non-one-click links require manual completion rather than a successful GET', async () => {
  let requests = 0
  const { unsubscribe } = load(
    'src/main/unsubscribe.ts',
    {},
    {
      './activity': {
        activityFetch: async () => {
          requests++
          return { ok: true }
        },
        openExternalWithActivity: async () => {},
        serviceDestination: () => 'example.com'
      }
    }
  )
  const result = await unsubscribe({
    unsubscribeUrls: ['https://example.com/unsubscribe'],
    oneClick: false
  })
  assert.equal(result.status, 'action-required')
  assert.equal(requests, 0)
})

test('POST failures record a domain-blocking flag even when the browser opens', async () => {
  const { unsubscribe } = load(
    'src/main/unsubscribe.ts',
    {},
    {
      './activity': {
        activityFetch: async () => ({ ok: false, status: 429 }),
        openExternalWithActivity: async () => {},
        serviceDestination: () => 'example.com'
      }
    }
  )
  const result = await unsubscribe({
    unsubscribeUrls: ['https://example.com/unsubscribe'],
    oneClick: true
  })
  assert.equal(result.status, 'action-required')
  assert.equal(result.requestFailed, true)
})

test('connection DNS lookup rejects a hostname with any private address', async () => {
  const { EventEmitter } = require('node:events')
  let lookupCount = 0
  const network = load(
    'src/main/network.ts',
    {},
    {
      'node:dns': {
        lookup: (_host, _options, callback) => {
          lookupCount++
          callback(null, [
            { address: '8.8.8.8', family: 4 },
            { address: '10.0.0.1', family: 4 }
          ])
        }
      },
      'node:https': {
        request: (url, options) => {
          const req = new EventEmitter()
          req.end = () =>
            options.lookup(url.hostname, {}, (error) => {
              req.emit('error', error)
              req.emit('close')
            })
          req.destroy = () => req.emit('close')
          return req
        }
      }
    }
  )
  await assert.rejects(
    network.publicPost('https://example.com', 'List-Unsubscribe=One-Click'),
    /non-public/
  )
  assert.equal(lookupCount, 1)
})

test('automatic POST returns redirects without a second request or DNS lookup', async () => {
  const { EventEmitter } = require('node:events')
  let requests = 0
  let lookups = 0
  const network = load(
    'src/main/network.ts',
    {},
    {
      'node:dns': {
        lookup: (_host, _options, callback) => {
          lookups++
          callback(null, [{ address: '8.8.8.8', family: 4 }])
        }
      },
      'node:https': {
        request: (url, options, callback) => {
          requests++
          assert.equal(options.method, 'POST')
          const req = new EventEmitter()
          req.end = (body) => {
            assert.equal(body, 'List-Unsubscribe=One-Click')
            options.lookup(url.hostname, { all: true }, (error, addresses) => {
              assert.equal(error, null)
              assert.equal(addresses[0].address, '8.8.8.8')
              callback({ statusCode: 302, destroy: () => {} })
              req.emit('close')
            })
          }
          req.destroy = () => req.emit('close')
          return req
        }
      }
    }
  )
  const response = await network.publicPost('https://example.com', 'List-Unsubscribe=One-Click')
  assert.equal(response.status, 302)
  assert.equal(requests, 1)
  assert.equal(lookups, 1)
})
