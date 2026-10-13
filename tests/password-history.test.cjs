/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./helpers.cjs')

const PASSWORD_KEY = 'newsletter-unsubscriber:encrypted-history:v1'
const LEGACY_KEY = 'newsletter-unsubscriber:v1'
const password = 'a long synthetic passphrase'
const history = {
  candidates: [
    {
      id: 'news@example.com|weekly.example.com',
      sender: 'news@example.com',
      subject: 'Private synthetic subject',
      listId: 'weekly.example.com',
      unsubscribeUrls: ['https://example.com/u?token=synthetic-personal-token'],
      oneClick: false,
      messageCount: 1,
      folderNames: ['Inbox'],
      firstSeen: '2026-10-01T12:00:00Z',
      updatedAt: '2026-10-01T12:00:00Z',
      status: 'found'
    }
  ]
}

function renderer(items = new Map(), options = {}) {
  let backend = options.backend ?? { candidates: [] }
  return {
    items,
    storage: load('src/renderer/src/storage.ts', {
      window: {
        localStorage: {
          getItem: (key) => items.get(key) ?? null,
          setItem: (key, value) => {
            if (options.quotaFailure) throw Error('storage quota exceeded')
            items.set(key, value)
          },
          removeItem: (key) => items.delete(key)
        },
        api: {
          history: {
            load: async () => ({
              state: backend,
              mode: 'session',
              locked: false,
              hasSavedHistory: false
            }),
            save: async (state) => {
              backend = state
              return { mode: 'session', locked: false, hasSavedHistory: false }
            },
            clear: async () => {
              backend = { candidates: [] }
              items.clear()
            }
          }
        }
      }
    })
  }
}

const crypto = load('src/renderer/src/history-crypto.ts')

test('password encryption round-trips without persisting the password or readable history', async () => {
  const key = await crypto.createHistoryPassword(password)
  assert.equal(key.key.extractable, false)
  const encrypted = await crypto.encryptPasswordHistory(history, key)
  for (const secret of [
    password,
    'news@example.com',
    'Private synthetic subject',
    'synthetic-personal-token'
  ])
    assert.equal(encrypted.includes(secret), false)
  const restored = await crypto.unlockPasswordHistory(encrypted, password)
  assert.deepEqual(JSON.parse(JSON.stringify(restored.state)), history)
  const again = await crypto.encryptPasswordHistory(history, key)
  assert.notEqual(JSON.parse(encrypted).iv, JSON.parse(again).iv)
  assert.notEqual(JSON.parse(encrypted).data, JSON.parse(again).data)
})

test('wrong passwords and altered ciphertext cannot unlock saved history', async () => {
  const key = await crypto.createHistoryPassword(password)
  const encrypted = await crypto.encryptPasswordHistory(history, key)
  await assert.rejects(crypto.unlockPasswordHistory(encrypted, 'another synthetic passphrase'))
  const envelope = JSON.parse(encrypted)
  const data = Buffer.from(envelope.data, 'base64')
  data[0] ^= 1
  envelope.data = data.toString('base64')
  await assert.rejects(crypto.unlockPasswordHistory(JSON.stringify(envelope), password))
})

test('setup rejects short passwords and encrypted inputs cannot reduce the work factor', async () => {
  await assert.rejects(crypto.createHistoryPassword('short'), /at least 12/)
  const key = await crypto.createHistoryPassword(password)
  const envelope = JSON.parse(await crypto.encryptPasswordHistory(history, key))
  envelope.iterations = 1
  await assert.rejects(
    crypto.unlockPasswordHistory(JSON.stringify(envelope), password),
    /Invalid encrypted/
  )
})

test('password mode persists only ciphertext and requires unlocking after renderer restart', async () => {
  const items = new Map([[LEGACY_KEY, JSON.stringify(history)]])
  const first = renderer(items)
  await first.storage.loadState()
  await first.storage.protectHistoryWithPassword(history, password)
  assert.equal(items.has(LEGACY_KEY), false)
  assert.equal(items.has(PASSWORD_KEY), true)
  assert.equal(first.storage.historyPasswordEnabled(), true)
  const updated = { candidates: [{ ...history.candidates[0], status: 'unsubscribed' }] }
  await first.storage.saveState(updated)
  assert.equal(items.get(PASSWORD_KEY).includes('news@example.com'), false)
  const restart = renderer(items)
  assert.equal((await restart.storage.loadState()).candidates.length, 0)
  assert.equal(restart.storage.historyPasswordLocked(), true)
  const before = items.get(PASSWORD_KEY)
  await restart.storage.saveState({ candidates: [] })
  assert.equal(items.get(PASSWORD_KEY), before)
  await assert.rejects(restart.storage.unlockHistoryWithPassword('wrong synthetic password'))
  assert.equal(restart.storage.historyPasswordLocked(), true)
  assert.equal(
    (await restart.storage.unlockHistoryWithPassword(password)).candidates[0].status,
    'unsubscribed'
  )
  assert.equal(restart.storage.historyPasswordLocked(), false)
})

test('password setup preserves original history when ciphertext cannot be committed', async () => {
  const raw = JSON.stringify(history)
  const items = new Map([[LEGACY_KEY, raw]])
  const run = renderer(items, { quotaFailure: true })
  await run.storage.loadState()
  await assert.rejects(run.storage.protectHistoryWithPassword(history, password), /quota/)
  assert.equal(items.get(LEGACY_KEY), raw)
  assert.equal(items.has(PASSWORD_KEY), false)
  assert.equal(run.storage.historyPasswordEnabled(), false)
})

test('UI reload preserves recent session changes over older legacy browser history', async () => {
  const items = new Map([[LEGACY_KEY, JSON.stringify(history)]])
  const recent = { candidates: [{ ...history.candidates[0], status: 'unsubscribed' }] }
  const run = renderer(items, { backend: recent })
  assert.equal((await run.storage.loadState()).candidates[0].status, 'unsubscribed')
  assert.match(run.storage.historyStorageMessage(), /still unencrypted/)
})

test('clearing history removes its ciphertext and releases the current password key', async () => {
  const run = renderer()
  await run.storage.protectHistoryWithPassword(history, password)
  await run.storage.clearState()
  assert.equal(run.items.has(PASSWORD_KEY), false)
  assert.equal(run.storage.historyPasswordEnabled(), false)
})

test('ciphertext files can be committed and restored without access to Keychain or the password', async (t) => {
  const fs = require('node:fs/promises')
  const { join } = require('node:path')
  const { tmpdir } = require('node:os')
  const directory = await fs.mkdtemp(join(tmpdir(), 'newsletter-password-file-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const backend = () =>
    load(
      'src/main/password-history.ts',
      {},
      {
        electron: { app: { getPath: () => directory } }
      }
    )
  const key = await crypto.createHistoryPassword(password)
  const encrypted = await crypto.encryptPasswordHistory(history, key)
  const first = backend()
  assert.equal(await first.loadPasswordHistory(), null)
  await first.savePasswordHistory(encrypted)
  const file = join(directory, 'newsletter-history-password.bin')
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
  const saved = await backend().loadPasswordHistory()
  assert.equal(saved.includes(password), false)
  assert.equal(saved.includes('news@example.com'), false)
  assert.equal((await crypto.unlockPasswordHistory(saved, password)).state.candidates.length, 1)
  assert.throws(() => first.savePasswordHistory('plaintext newsletter history'))
  await first.clearPasswordHistory()
  assert.equal(await first.loadPasswordHistory(), null)
})

test('a browser backup is authenticated before file migration can remove legacy data', async () => {
  const key = await crypto.createHistoryPassword(password)
  const encrypted = await crypto.encryptPasswordHistory(history, key)
  const items = new Map([
    [LEGACY_KEY, JSON.stringify(history)],
    [PASSWORD_KEY, encrypted]
  ])
  let file = null
  const events = []
  const storage = load('src/renderer/src/storage.ts', {
    window: {
      localStorage: {
        getItem: (name) => items.get(name) ?? null,
        removeItem: (name) => items.delete(name),
        setItem: (name, value) => items.set(name, value)
      },
      api: {
        history: {
          loadPassword: async () => file,
          savePassword: async (value) => {
            events.push('save ciphertext')
            file = value
          },
          purgeLegacy: async () => {
            events.push('purge database')
            items.clear()
          }
        }
      }
    }
  })
  await storage.loadState()
  assert.equal(file, null)
  assert.equal(items.has(LEGACY_KEY), true)
  await assert.rejects(storage.unlockHistoryWithPassword('wrong synthetic password'))
  assert.equal(file, null)
  assert.equal(items.has(LEGACY_KEY), true)
  assert.equal((await storage.unlockHistoryWithPassword(password)).candidates.length, 1)
  assert.deepEqual(events, ['save ciphertext', 'purge database'])
  assert.equal(items.size, 0)
  assert.equal(file, encrypted)
})

test('unreadable ciphertext files remain locked instead of being silently replaced', async () => {
  const storage = load('src/renderer/src/storage.ts', {
    window: {
      localStorage: { getItem: () => null },
      api: {
        history: {
          loadPassword: async () => {
            throw Error('saved ciphertext unreadable')
          }
        }
      }
    }
  })
  assert.equal((await storage.loadState()).candidates.length, 0)
  assert.equal(storage.historyPasswordLocked(), true)
  assert.match(storage.historyStorageMessage(), /preserved/)
  await assert.rejects(storage.protectHistoryWithPassword(history, password), /Unlock/)
})
