/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./helpers.cjs')

const account = {
  username: 'tester@example.com',
  name: 'Synthetic Tester',
  homeAccountId: 'synthetic'
}
const freshToken = 'synthetic-current-token'

function harness(options = {}) {
  const calls = {
    reads: 0,
    writes: [],
    modes: [],
    removed: [],
    deserializations: 0,
    notices: [],
    encryptions: 0
  }
  let file = options.cached ? Buffer.from('synthetic-encrypted-cache') : undefined
  let encryptedData = options.cached
  let plugin,
    memory = { accounts: [], token: null }
  class InteractionRequiredAuthError extends Error {}
  const context = (changed) => ({ cache, cacheHasChanged: changed })
  const cache = {
    deserialize(data) {
      calls.deserializations++
      if (data) memory = JSON.parse(data)
    },
    serialize: () => JSON.stringify(memory),
    async getAllAccounts() {
      await plugin.beforeCacheAccess(context(false))
      const accounts = memory.accounts
      await plugin.afterCacheAccess(context(false))
      return accounts
    },
    async removeAccount(item) {
      await plugin.beforeCacheAccess(context(true))
      memory = {
        accounts: memory.accounts.filter((saved) => saved.username !== item.username),
        token: null
      }
      await plugin.afterCacheAccess(context(true))
    }
  }
  class PublicClientApplication {
    constructor(config) {
      plugin = config.cache.cachePlugin
    }
    getTokenCache() {
      return cache
    }
    async acquireTokenByDeviceCode(request) {
      await plugin.beforeCacheAccess(context(false))
      request.deviceCodeCallback({
        userCode: 'SYNTHETIC',
        verificationUri: 'https://example.com/device',
        message: 'Synthetic sign-in'
      })
      memory = { accounts: [account], token: freshToken }
      await plugin.afterCacheAccess(context(true))
      return { account, accessToken: freshToken }
    }
    async acquireTokenSilent() {
      // Like MSAL's overwriteCache(), silent acquisition starts with cleared storage.
      memory = { accounts: [], token: null }
      await plugin.beforeCacheAccess(context(false))
      if (options.silentError === 'expired')
        throw new InteractionRequiredAuthError('interaction required')
      if (options.silentError === 'network') throw Error('offline')
      if (!memory.token) throw new InteractionRequiredAuthError('no token')
      if (options.refresh) {
        memory.token = freshToken
        await plugin.afterCacheAccess(context(true))
      }
      return { account: memory.accounts[0], accessToken: memory.token }
    }
  }
  const auth = load(
    'src/main/auth.ts',
    { process: { platform: options.platform ?? 'darwin' } },
    {
      '@azure/msal-node': {
        PublicClientApplication,
        LogLevel: { Warning: 1 },
        InteractionRequiredAuthError
      },
      './config': {
        getAuthSettings: () => ({ clientId: 'synthetic' }),
        GRAPH_SCOPES: ['Mail.Read']
      },
      './activity': {
        beginActivity: () => (status, detail) => calls.notices.push({ status, detail })
      },
      electron: {
        app: { getPath: () => '/synthetic-app-data' },
        safeStorage: {
          isEncryptionAvailable: () => options.available !== false,
          getSelectedStorageBackend: () => options.backend ?? 'gnome_libsecret',
          decryptString: () => {
            if (options.decryptFails) throw Error('keychain locked')
            return encryptedData
          },
          encryptString: (data) => {
            calls.encryptions++
            if (options.encryptFails) throw Error('keychain denied')
            encryptedData = data
            return Buffer.from('synthetic-encrypted-cache')
          }
        }
      },
      'node:fs/promises': {
        readFile: async () => {
          calls.reads++
          if (!file) throw Object.assign(Error('missing cache'), { code: 'ENOENT' })
          return file
        },
        mkdir: async () => {},
        writeFile: async (_path, data, settings) => {
          assert.ok(Buffer.isBuffer(data))
          assert.equal(data.toString(), 'synthetic-encrypted-cache')
          if (options.writeFails) throw Error('disk unavailable')
          calls.writes.push(data)
          calls.modes.push(settings.mode)
          file = data
        },
        chmod: async (_path, mode) => {
          assert.equal(mode, 0o600)
        },
        rm: async (path) => {
          calls.removed.push(path)
          file = undefined
        }
      }
    }
  )
  return { auth, calls, stored: () => file, plugin: () => plugin, memory: () => memory }
}

test('unavailable Keychain allows device login and later mailbox token access without disk writes', async () => {
  const run = harness({ available: false })
  assert.equal(await run.auth.getActiveAccount(), null)
  let receivedCode = false
  const signedIn = await run.auth.acquireToken(() => {
    receivedCode = true
  })
  assert.equal(receivedCode, true)
  assert.equal(signedIn.username, account.username)
  assert.equal(signedIn.sessionOnly, true)
  assert.equal(await run.auth.getAccessToken(), freshToken)
  assert.equal((await run.auth.getActiveAccount()).username, account.username)
  assert.equal(run.calls.writes.length, 0)
  assert.equal(run.calls.encryptions, 0)
  assert.ok(run.calls.deserializations > 0)
  assert.equal(run.calls.notices.length, 1)
  await run.auth.signOut()
  assert.equal(await run.auth.getActiveAccount(), null)
  await assert.rejects(run.auth.getAccessToken(), /Not signed in/)
})

test('encryption and persistence failures preserve a successful in-memory login', async () => {
  for (const failure of [{ encryptFails: true }, { writeFails: true }]) {
    const run = harness(failure)
    const signedIn = await run.auth.acquireToken(() => {})
    assert.equal(signedIn.sessionOnly, true)
    assert.equal(await run.auth.getAccessToken(), freshToken)
    assert.equal(run.calls.writes.length, 0)
    assert.equal(run.calls.reads, 1)
    assert.equal(run.calls.notices.length, 1)
  }
})

test('a locked saved cache is neither overwritten nor repeatedly decrypted during a session', async () => {
  const run = harness({
    cached: JSON.stringify({ accounts: [account], token: 'synthetic-old-token' }),
    decryptFails: true
  })
  const original = run.stored()
  assert.equal(await run.auth.getActiveAccount(), null)
  assert.equal((await run.auth.acquireToken(() => {})).sessionOnly, true)
  assert.equal(await run.auth.getAccessToken(), freshToken)
  assert.equal(run.calls.reads, 1)
  assert.equal(run.calls.writes.length, 0)
  assert.equal(run.stored(), original)
  await run.auth.signOut()
  assert.equal(run.stored(), undefined)
  assert.equal(run.calls.removed.length, 1)
})

test('malformed decrypted cache falls back to a usable session without overwriting it', async () => {
  const run = harness({ cached: 'malformed synthetic cache' })
  const original = run.stored()
  assert.equal((await run.auth.acquireToken(() => {})).sessionOnly, true)
  assert.equal(await run.auth.getAccessToken(), freshToken)
  assert.equal(run.stored(), original)
  assert.equal(run.calls.writes.length, 0)
})

test('healthy secure storage persists encrypted data with owner-only permissions', async () => {
  const run = harness()
  const signedIn = await run.auth.acquireToken(() => {})
  assert.equal(signedIn.sessionOnly, false)
  assert.equal(await run.auth.getAccessToken(), freshToken)
  assert.equal(run.calls.writes.length, 1)
  assert.equal(run.calls.modes[0], 0o600)
  assert.equal(run.calls.notices.length, 0)
  await run.auth.signOut()
  assert.equal(run.stored(), undefined)
})

test('restored disk tokens are loaded once and cannot replace a refreshed session token', async () => {
  const run = harness({
    cached: JSON.stringify({ accounts: [account], token: 'synthetic-old-token' }),
    refresh: true
  })
  assert.equal((await run.auth.getActiveAccount()).sessionOnly, false)
  assert.equal(
    (
      await run.auth.acquireToken(() => {
        throw Error('must stay silent')
      })
    ).username,
    account.username
  )
  assert.equal(await run.auth.getAccessToken(), freshToken)
  assert.equal(run.calls.reads, 1)
  assert.ok(run.calls.deserializations > 1)
})

test('concurrent cache accesses restore the saved cache only once', async () => {
  const run = harness({ cached: JSON.stringify({ accounts: [account], token: freshToken }) })
  const accounts = await Promise.all([run.auth.getActiveAccount(), run.auth.getActiveAccount()])
  assert.equal(accounts[0].username, account.username)
  assert.equal(accounts[1].username, account.username)
  assert.equal(run.calls.reads, 1)
  assert.equal(run.calls.deserializations, 2)
})

test('Linux basic_text storage is never used to persist credentials', async () => {
  const run = harness({ platform: 'linux', backend: 'basic_text' })
  assert.equal((await run.auth.acquireToken(() => {})).sessionOnly, true)
  assert.equal(await run.auth.getAccessToken(), freshToken)
  assert.equal(run.calls.writes.length, 0)
  assert.equal(run.calls.encryptions, 0)
})

test('refresh distinguishes an expired session from a temporary network error', async () => {
  for (const [silentError, expected] of [
    ['expired', /sign-in expired/],
    ['network', /Check your connection/]
  ]) {
    const run = harness({ silentError })
    await run.auth.acquireToken(() => {})
    await assert.rejects(run.auth.getAccessToken(), expected)
  }
})

test('real MSAL cache survives silent overwrite and supplies a token for folder listing', async () => {
  const msal = require('@azure/msal-node')
  let cache, plugin
  const fixture = JSON.stringify({
    Account: {
      'synthetic-login.microsoftonline.com-synthetic': {
        home_account_id: 'synthetic',
        environment: 'login.microsoftonline.com',
        realm: 'synthetic',
        local_account_id: 'synthetic',
        username: 'tester@example.com',
        authority_type: 'MSSTS'
      }
    },
    AccessToken: {
      'synthetic-access-token': {
        home_account_id: 'synthetic',
        environment: 'login.microsoftonline.com',
        credential_type: 'AccessToken',
        client_id: 'synthetic',
        secret: freshToken,
        realm: 'synthetic',
        target: 'Mail.Read',
        cached_at: '1',
        expires_on: '9999999999',
        extended_expires_on: '9999999999'
      }
    }
  })
  class PublicClientApplication {
    constructor(config) {
      plugin = config.cache.cachePlugin
      cache = new msal.PublicClientApplication(config).getTokenCache()
    }
    getTokenCache() {
      return cache
    }
    async acquireTokenByDeviceCode() {
      await plugin.beforeCacheAccess({ cache, cacheHasChanged: false })
      cache.deserialize(fixture)
      await plugin.afterCacheAccess({ cache, cacheHasChanged: true })
      return { account: (await cache.getAllAccounts())[0], accessToken: freshToken }
    }
    async acquireTokenSilent() {
      // Invoke MSAL's actual implementation, including its destructive reset.
      await cache.overwriteCache()
      const serialized = JSON.parse(cache.serialize())
      const token = Object.values(serialized.AccessToken)[0]?.secret
      if (!token) throw new msal.InteractionRequiredAuthError('no_tokens_found')
      return { account: (await cache.getAllAccounts())[0], accessToken: token }
    }
  }
  const auth = load(
    'src/main/auth.ts',
    { process: { platform: 'darwin' } },
    {
      '@azure/msal-node': { ...msal, PublicClientApplication },
      './config': {
        getAuthSettings: () => ({ clientId: 'synthetic' }),
        GRAPH_SCOPES: ['Mail.Read']
      },
      './activity': { beginActivity: () => () => {} },
      electron: {
        app: { getPath: () => '/synthetic-app-data' },
        safeStorage: { isEncryptionAvailable: () => false }
      },
      'node:fs/promises': { rm: async () => {} }
    }
  )
  assert.equal((await auth.acquireToken(() => {})).sessionOnly, true)
  const requests = []
  const graph = load(
    'src/main/graph.ts',
    {},
    {
      './auth': auth,
      './config': { GRAPH_BASE_URL: 'https://graph.microsoft.com/v1.0' },
      './activity': {
        activityFetch: async (_url, init) => {
          requests.push(init.headers.Authorization)
          return {
            ok: true,
            json: async () => ({
              value: [{ id: 'synthetic-folder', displayName: 'Inbox', childFolderCount: 0 }]
            })
          }
        }
      }
    }
  )
  assert.equal((await graph.getMailboxFolders())[0].displayName, 'Inbox')
  assert.equal((await graph.getMailboxFolders())[0].displayName, 'Inbox')
  assert.deepEqual(requests, [`Bearer ${freshToken}`, `Bearer ${freshToken}`])
  await auth.signOut()
  assert.equal(await auth.getActiveAccount(), null)
})
