import { PublicClientApplication, LogLevel } from '@azure/msal-node'
import type { AccountInfo as MsalAccountInfo, Configuration } from '@azure/msal-node'
import { app, safeStorage } from 'electron'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getAuthSettings, GRAPH_SCOPES } from './config'
import type { AccountInfo, DeviceCodeInfo } from '../shared/types'

function cacheFile(): string {
  return join(app.getPath('userData'), 'msal-cache.bin')
}

async function readCache(): Promise<string> {
  try {
    const buffer = await readFile(cacheFile())
    if (!safeStorage.isEncryptionAvailable()) return ''
    return safeStorage.decryptString(buffer)
  } catch {
    return ''
  }
}

async function writeCache(data: string): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  if (!safeStorage.isEncryptionAvailable())
    throw new Error(
      'Secure credential storage is unavailable. Sign-in cannot be saved on this device.'
    )
  await writeFile(cacheFile(), safeStorage.encryptString(data), { mode: 0o600 })
  await chmod(cacheFile(), 0o600)
}

function createClient(): PublicClientApplication {
  const config: Configuration = {
    auth: getAuthSettings(),
    cache: {
      cachePlugin: {
        beforeCacheAccess: async (context) => {
          context.cache.deserialize(await readCache())
        },
        afterCacheAccess: async (context) => {
          if (context.cacheHasChanged) {
            await writeCache(context.cache.serialize())
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
  return { username: account.username, name: account.name }
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
  } catch {
    throw new Error('Your sign-in expired. Please sign in again.')
  }
}

export async function signOut(): Promise<void> {
  const accounts = await getClient().getTokenCache().getAllAccounts()
  for (const account of accounts) {
    await getClient().getTokenCache().removeAccount(account)
  }
  activeAccount = null
}
