/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { load } = require('./helpers.cjs')

const password = 'a long synthetic passphrase'
const crypto = load('src/renderer/src/history-crypto.ts')

async function fixture(t) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'newsletter-reset-test-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const electron = {
    app: { getPath: () => directory },
    safeStorage: { isEncryptionAvailable: () => false }
  }
  const history = load('src/main/history.ts', {}, { electron })
  const passwords = load('src/main/password-history.ts', {}, { electron })
  const activity = load('src/main/activity.ts')
  const reset = load(
    'src/main/reset.ts',
    {},
    {
      './history': history,
      './password-history': passwords,
      './activity': activity
    }
  )
  const key = await crypto.createHistoryPassword(password)
  const encrypted = await crypto.encryptPasswordHistory(
    {
      candidates: [],
      lastScan: {
        candidates: [],
        messageCount: 25,
        scannedFolderIds: ['inbox'],
        scannedAt: '2026-10-13T12:00:00Z'
      }
    },
    key
  )
  await passwords.savePasswordHistory(encrypted)
  await fs.writeFile(join(directory, 'newsletter-history.bin'), 'preserved locked fixture')
  activity.beginActivity('Synthetic scan', 'Microsoft Graph', 'GET')('success', 'Done.')
  let legacy = true
  const session = {
    clearStorageData: async (options) => {
      assert.deepEqual(JSON.parse(JSON.stringify(options)), { storages: ['localstorage'] })
      legacy = false
    }
  }
  return {
    directory,
    history,
    passwords,
    activity,
    reset,
    key,
    encrypted,
    session,
    legacy: () => legacy
  }
}

test('reset removes both saved history formats, legacy browser data, and activity', async (t) => {
  const f = await fixture(t)
  await f.reset.resetStats(f.session, undefined)
  assert.equal(await f.passwords.loadPasswordHistory(), null)
  await assert.rejects(fs.stat(join(f.directory, 'newsletter-history.bin')), { code: 'ENOENT' })
  assert.equal((await f.history.loadHistory()).state.candidates.length, 0)
  assert.equal((await f.history.loadHistory()).state.lastScan, undefined)
  assert.equal(f.legacy(), false)
  assert.equal(f.activity.getActivity().length, 0)
})

test('password-protected reset leaves an empty history that the existing password can unlock', async (t) => {
  const f = await fixture(t)
  const empty = await crypto.encryptPasswordHistory({ candidates: [] }, f.key)
  await f.reset.resetStats(f.session, empty)
  const saved = await f.passwords.loadPasswordHistory()
  const restored = await crypto.unlockPasswordHistory(saved, password)
  assert.deepEqual(JSON.parse(JSON.stringify(restored.state)), { candidates: [] })
  assert.equal(
    (await fs.stat(join(f.directory, 'newsletter-history-password.bin'))).mode & 0o777,
    0o600
  )
  assert.equal(f.legacy(), false)
  assert.equal(f.activity.getActivity().length, 0)
})

test('invalid reset ciphertext is rejected before any existing history is removed', async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.reset.resetStats(f.session, 'plaintext'), /JSON|Unexpected/)
  assert.equal(await f.passwords.loadPasswordHistory(), f.encrypted)
  assert.equal(f.legacy(), true)
  assert.equal(f.activity.getActivity().length, 1)
  await fs.stat(join(f.directory, 'newsletter-history.bin'))
})

test('reset waits for pending requests so an in-flight result cannot repopulate cleared activity', async (t) => {
  const f = await fixture(t)
  const finish = f.activity.beginActivity('Synthetic request', 'Microsoft Graph', 'GET')
  await assert.rejects(f.reset.resetStats(f.session, undefined), /current requests/)
  assert.equal(await f.passwords.loadPasswordHistory(), f.encrypted)
  assert.equal(f.legacy(), true)
  finish('success', 'Done.')
  await f.reset.resetStats(f.session, undefined)
  assert.equal(f.activity.getActivity().length, 0)
})

test('a failed ciphertext commit preserves the earlier history and activity for retry', async (t) => {
  const f = await fixture(t)
  await fs.writeFile(join(f.directory, 'newsletter-history-password.bin.tmp'), 'occupied')
  const empty = await crypto.encryptPasswordHistory({ candidates: [] }, f.key)
  await assert.rejects(f.reset.resetStats(f.session, empty), { code: 'EEXIST' })
  assert.equal(await f.passwords.loadPasswordHistory(), f.encrypted)
  assert.equal(f.legacy(), true)
  assert.equal(f.activity.getActivity().length, 1)
  await fs.stat(join(f.directory, 'newsletter-history.bin'))
})

test('renderer reset retains its password key and requires the same password after reload', async (t) => {
  const f = await fixture(t)
  const items = new Map()
  const api = {
    loadPassword: () => f.passwords.loadPasswordHistory(),
    reset: (encrypted) => f.reset.resetStats(f.session, encrypted)
  }
  const renderer = () =>
    load('src/renderer/src/storage.ts', {
      window: {
        localStorage: {
          getItem: (key) => items.get(key) ?? null,
          removeItem: (key) => items.delete(key)
        },
        api: { history: api }
      }
    })
  const first = renderer()
  await first.loadState()
  await assert.rejects(first.resetState(), /Unlock/)
  await first.unlockHistoryWithPassword(password)
  await first.resetState()
  assert.equal(first.historyPasswordEnabled(), true)
  assert.equal(first.historyPasswordLocked(), false)
  const restarted = renderer()
  await restarted.loadState()
  assert.equal(restarted.historyPasswordLocked(), true)
  const state = await restarted.unlockHistoryWithPassword(password)
  assert.equal(state.candidates.length, 0)
  assert.equal(state.lastScan, undefined)
})
