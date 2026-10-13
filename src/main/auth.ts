import { PublicClientApplication, LogLevel, InteractionRequiredAuthError } from '@azure/msal-node'
import type { AccountInfo as MsalAccountInfo, Configuration } from '@azure/msal-node'
import { app, safeStorage } from 'electron'
import { chmod, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getAuthSettings, GRAPH_SCOPES } from './config'
import { beginActivity } from './activity'
import { secureStorageAvailable } from './secure-storage'
import type { AccountInfo, DeviceCodeInfo } from '../shared/types'

function cacheFile(): string {
  return join(app.getPath('userData'), 'msal-cache.bin')
}

let sessionOnly = false

function useSessionCache(): void {
  if (sessionOnly) return
  sessionOnly = true
  const finish = beginActivity('Keep sign-in for this session', 'This app', 'Credential storage')
  finish(
    'action-required',
    'Secure credential storage is unavailable. You can continue, but you will need to sign in again after restarting the app.'
  )
}

async function readCache(): Promise<string | undefined> {
  try {
    if (!secureStorageAvailable()) {
      useSessionCache()
      return undefined
    }
    const buffer = await readFile(cacheFile())
    return safeStorage.decryptString(buffer)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') useSessionCache()
    return undefined
  }
}

async function writeCache(data: string): Promise<void> {
  if (sessionOnly) return
  try {
    if (!secureStorageAvailable()) {
      useSessionCache()
      return
    }
    // Encrypt before creating or overwriting any file. Persistence failure must
    // not turn a successful Microsoft token exchange into a failed sign-in.
    const encrypted = safeStorage.encryptString(data)
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(cacheFile(), encrypted, { mode: 0o600 })
    await chmod(cacheFile(), 0o600)
  } catch {
    useSessionCache()
  }
}

function createClient(): PublicClientApplication {
  let loaded = false
  let loading: Promise<string | undefined> | undefined
  let snapshot: string | undefined
  let writing = Promise.resolve()
  const config: Configuration = {
    auth: getAuthSettings(),
    cache: {
      cachePlugin: {
        beforeCacheAccess: async (context) => {
          // Read disk once, but restore the current in-memory snapshot on every
          // access: MSAL's silent flow clears its storage in overwriteCache().
          if (!loaded) {
            loading ??= readCache()
            const saved = await loading
            if (!loaded) {
              snapshot = saved
              loaded = true
            }
          }
          try {
            context.cache.deserialize(snapshot ?? '')
          } catch {
            snapshot = undefined
            context.cache.deserialize('')
            useSessionCache()
          }
        },
        afterCacheAccess: async (context) => {
          if (context.cacheHasChanged) {
            const data = context.cache.serialize()
            snapshot = data
            writing = writing.then(() => writeCache(data))
            await writing
          }
        }
      }
    },
    system: {
      loggerOptions: {
        loggerCallback: () => {},
        logLevel: LogLevel.Warning,
        piiLoggingEnabled: false
      }
    }
  }

  return new PublicClientApplication(config)
}
let client: PublicClientApplication | undefined
function getClient(): PublicClientApplication {
  client ??= createClient()
  return client
}

let activeAccount: MsalAccountInfo | null = null

function toAccountInfo(account: MsalAccountInfo): AccountInfo {
  return { username: account.username, name: account.name, sessionOnly }
}

export async function getActiveAccount(): Promise<AccountInfo | null> {
  const accounts = await getClient().getTokenCache().getAllAccounts()
  activeAccount = accounts[0] ?? null
  return activeAccount ? toAccountInfo(activeAccount) : null
}

export async function acquireToken(
  onDeviceCode: (info: DeviceCodeInfo) => void
): Promise<AccountInfo> {
  const accounts = await getClient().getTokenCache().getAllAccounts()
  if (accounts[0]) {
    try {
      const result = await getClient().acquireTokenSilent({
        account: accounts[0],
        scopes: GRAPH_SCOPES
      })
      if (result?.account) {
        activeAccount = result.account
        return toAccountInfo(result.account)
      }
    } catch {
      // Fall through to an interactive device code sign-in.
    }
  }

  const result = await getClient().acquireTokenByDeviceCode({
    scopes: GRAPH_SCOPES,
    deviceCodeCallback: (response) => {
      onDeviceCode({
        userCode: response.userCode,
        verificationUri: response.verificationUri,
        message: response.message
      })
    }
  })

  if (!result?.account) {
    throw new Error('Sign-in did not return an account.')
  }
  activeAccount = result.account
  return toAccountInfo(result.account)
}

export async function getAccessToken(): Promise<string> {
  const accounts = await getClient().getTokenCache().getAllAccounts()
  const account = activeAccount ?? accounts[0]
  if (!account) {
    throw new Error('Not signed in.')
  }
  try {
    const result = await getClient().acquireTokenSilent({ account, scopes: GRAPH_SCOPES })
    if (!result) {
      throw new Error('No token was returned.')
    }
    return result.accessToken
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError)
      throw new Error('Your sign-in expired. Please sign in again.')
    throw new Error(
      'Microsoft could not refresh your sign-in. Check your connection and try again.'
    )
  }
}

export async function signOut(): Promise<void> {
  const accounts = await getClient().getTokenCache().getAllAccounts()
  for (const account of accounts) {
    await getClient().getTokenCache().removeAccount(account)
  }
  activeAccount = null
  // A locked cache may still contain the previously saved account. Remove it
  // even when the current session cannot encrypt or decrypt credentials.
  await rm(cacheFile(), { force: true })
}
