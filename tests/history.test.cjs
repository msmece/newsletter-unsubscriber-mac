/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto')
const { load } = require('./helpers.cjs')

const candidate = (extra = {}) => ({
  id: 'news@example.com|weekly.example.com',
  sender: 'news@example.com',
  subject: 'Synthetic private subject',
  listId: 'weekly.example.com',
  unsubscribeUrls: ['https://example.com/u?token=synthetic-personal-token'],
  unsubscribeLinks: [
    {
      url: 'https://example.com/u?token=synthetic-personal-token',
      oneClick: true,
      receivedAt: '2026-10-01T12:00:00Z'
    }
  ],
  oneClick: true,
  messageCount: 1,
  folderNames: ['Inbox'],
  firstSeen: '2026-10-01T12:00:00Z',
  status: 'found',
  updatedAt: '2026-10-01T12:00:00Z',
  ...extra
})
const state = (extra = {}) => ({ candidates: [candidate(extra)] })
const plain = (value) => JSON.parse(JSON.stringify(value))

async function fixture(t) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'newsletter-history-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const wrappingKey = randomBytes(32)
  const file = join(directory, 'newsletter-history.bin')
  function store(options = {}) {
    return load(
      'src/main/history.ts',
      { process: { platform: options.platform ?? 'darwin' } },
      {
        electron: {
          app: { getPath: () => directory },
          safeStorage: {
            isEncryptionAvailable: () => options.available !== false,
            getSelectedStorageBackend: () => options.backend ?? 'gnome_libsecret',
            encryptString: (value) => {
              if (options.encryptFails) throw Error('Keychain denied')
              const iv = randomBytes(12)
              const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv)
              const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
              return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
            },
            decryptString: (value) => {
              const decipher = createDecipheriv('aes-256-gcm', wrappingKey, value.subarray(0, 12))
              decipher.setAuthTag(value.subarray(12, 28))
              return Buffer.concat([
                decipher.update(value.subarray(28)),
                decipher.final()
              ]).toString('utf8')
            }
          }
        },
        ...(options.writeFails
          ? {
              'node:fs/promises': {
                ...fs,
                writeFile: async (path, data, settings) => {
                  await fs.writeFile(path, data.subarray(0, 8), settings)
                  throw Error('partial disk write')
                }
              }
            }
          : {})
      }
    )
  }
  return { store, file }
}

test('history round-trips through encrypted storage without exposing mailbox fields', async (t) => {
  const { store, file } = await fixture(t)
  const first = store()
  assert.equal((await first.saveHistory(state())).mode, 'encrypted')
  const encrypted = await fs.readFile(file)
  for (const privateValue of [
    'news@example.com',
    'Synthetic private subject',
    'synthetic-personal-token',
    'Inbox'
  ])
    assert.equal(encrypted.toString('utf8').includes(privateValue), false)
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
  const restored = await store().loadHistory()
  assert.equal(restored.mode, 'encrypted')
  assert.equal(restored.hasSavedHistory, true)
  assert.deepEqual(plain(restored.state), state())
})

test('each write uses fresh keys and nonces while preserving the same readable state', async (t) => {
  const { store, file } = await fixture(t)
  const history = store()
  await history.saveHistory(state())
  const first = JSON.parse(await fs.readFile(file, 'utf8'))
  await history.saveHistory(state())
  const second = JSON.parse(await fs.readFile(file, 'utf8'))
  assert.notEqual(first.iv, second.iv)
  assert.notEqual(first.key, second.key)
  assert.notEqual(first.data, second.data)
  assert.deepEqual(plain((await store().loadHistory()).state), state())
})

test('unavailable and basic_text secure stores retain new history only in memory', async (t) => {
  const { store, file } = await fixture(t)
  for (const options of [{ available: false }, { platform: 'linux', backend: 'basic_text' }]) {
    const history = store(options)
    assert.equal((await history.saveHistory(state())).mode, 'session')
    assert.deepEqual(plain((await history.loadHistory()).state), state())
    await assert.rejects(fs.readFile(file), { code: 'ENOENT' })
    assert.equal((await store(options).loadHistory()).state.candidates.length, 0)
  }
})

test('locked encrypted history is preserved while new scans run in memory', async (t) => {
  const { store, file } = await fixture(t)
  await store().saveHistory(state())
  const before = await fs.readFile(file)
  const locked = store({ available: false })
  assert.equal((await locked.loadHistory()).locked, true)
  assert.equal((await locked.saveHistory(state({ status: 'failed' }))).mode, 'session')
  assert.deepEqual(await fs.readFile(file), before)
  assert.equal((await store().loadHistory()).state.candidates[0].status, 'found')
  await locked.clearHistory()
  await assert.rejects(fs.readFile(file), { code: 'ENOENT' })
  assert.equal((await locked.loadHistory()).state.candidates.length, 0)
})

test('ciphertext tampering is rejected and cannot silently change unsubscribe history', async (t) => {
  const { store, file } = await fixture(t)
  await store().saveHistory(state())
  const envelope = JSON.parse(await fs.readFile(file, 'utf8'))
  const data = Buffer.from(envelope.data, 'base64')
  data[0] ^= 1
  envelope.data = data.toString('base64')
  await fs.writeFile(file, JSON.stringify(envelope))
  const tampered = await fs.readFile(file)
  const history = store()
  const restored = await history.loadHistory()
  assert.equal(restored.locked, true)
  assert.equal(restored.state.candidates.length, 0)
  await history.saveHistory(state({ status: 'unsubscribed' }))
  assert.deepEqual(await fs.readFile(file), tampered)
})

test('partial write failure leaves the previously encrypted file intact and cleans temporary data', async (t) => {
  const { store, file } = await fixture(t)
  await store().saveHistory(state())
  const before = await fs.readFile(file)
  const failed = store({ writeFails: true })
  assert.equal((await failed.saveHistory(state({ status: 'failed' }))).mode, 'session')
  assert.equal((await failed.loadHistory()).state.candidates[0].status, 'failed')
  assert.deepEqual(await fs.readFile(file), before)
  await assert.rejects(fs.readFile(`${file}.tmp`), { code: 'ENOENT' })
})

test('queued saves cannot resurrect history after a clear operation', async (t) => {
  const { store, file } = await fixture(t)
  const history = store()
  await Promise.all([
    history.saveHistory(state()),
    history.saveHistory(state({ status: 'failed' })),
    history.clearHistory()
  ])
  assert.equal((await history.loadHistory()).state.candidates.length, 0)
  await assert.rejects(fs.readFile(file), { code: 'ENOENT' })
})

test('invalid history IPC payloads are rejected before touching files', async (t) => {
  const { store, file } = await fixture(t)
  const history = store()
  for (const value of [
    null,
    {},
    { candidates: [null] },
    { candidates: [candidate({ firstSeen: {} })] },
    { candidates: [], lastScan: { messageCount: -1 } }
  ])
    assert.throws(() => history.saveHistory(value))
  await assert.rejects(fs.readFile(file), { code: 'ENOENT' })
})

function rendererStorage(options = {}) {
  let raw = JSON.stringify(state())
  const events = [],
    saves = []
  const info = {
    mode: options.session ? 'session' : 'encrypted',
    locked: false,
    hasSavedHistory: !options.session
  }
  const storage = load('src/renderer/src/storage.ts', {
    window: {
      localStorage: {
        getItem: (key) => (key === 'newsletter-unsubscriber:v1' ? raw : null),
        removeItem: () => {
          events.push('remove')
          raw = null
        },
        setItem: () => {
          throw Error('plaintext writes forbidden')
        }
      },
      api: {
        history: {
          load: async () => ({
            ...info,
            hasSavedHistory: Boolean(options.saved),
            state: options.saved ?? { candidates: [] }
          }),
          save: async (value) => {
            events.push('save')
            saves.push(value)
            return info
          },
          purgeLegacy: async () => {
            events.push('purge')
            if (options.cleanupFails) throw Error('cleanup failure')
          },
          clear: async () => {
            events.push('clear')
            return info
          }
        }
      }
    }
  })
  return { storage, events, saves, raw: () => raw }
}

test('legacy history is removed only after its encrypted migration is committed', async () => {
  const run = rendererStorage()
  assert.equal((await run.storage.loadState()).candidates.length, 1)
  assert.deepEqual(run.events, ['save', 'purge', 'remove'])
  assert.equal(run.raw(), null)
  assert.equal(run.storage.historyStorageMessage(), '')
})

test('failed encrypted migration preserves legacy data and makes its plaintext status explicit', async () => {
  const run = rendererStorage({ session: true })
  const original = run.raw()
  await run.storage.loadState()
  await run.storage.saveState(state({ status: 'failed' }))
  assert.equal(run.raw(), original)
  assert.deepEqual(run.events, ['save', 'save'])
  assert.match(run.storage.historyStorageMessage(), /still unencrypted/)
  assert.equal(run.saves[1].candidates[0].status, 'failed')
})

test('valid encrypted history wins over an old browser copy and cleans up its plaintext duplicate', async () => {
  const run = rendererStorage({ saved: state({ status: 'failed' }) })
  assert.equal((await run.storage.loadState()).candidates[0].status, 'failed')
  assert.equal(run.saves.length, 0)
  assert.equal(run.raw(), null)
  assert.equal(run.storage.historyStorageMessage(), '')
})

test('cleanup failure is reported rather than claiming all legacy data is encrypted', async () => {
  const run = rendererStorage({ cleanupFails: true })
  await run.storage.loadState()
  assert.notEqual(run.raw(), null)
  assert.match(run.storage.historyStorageMessage(), /old browser copy could not be removed/)
})

test('clearing history removes both backend data and the old browser key', async () => {
  const run = rendererStorage({ session: true })
  await run.storage.loadState()
  await run.storage.clearState()
  assert.equal(run.raw(), null)
  assert.deepEqual(run.events.slice(-3), ['clear', 'remove', 'remove'])
})
