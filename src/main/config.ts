import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Local development settings never enter the renderer bundle or Git.
if (!app.isPackaged) {
  try {
    process.loadEnvFile('.env')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Could not read the local .env configuration.')
  }
}

export function getAuthSettings(): { clientId: string; authority: string } {
  let settings: Record<string, string> = {}
  try {
    settings = JSON.parse(readFileSync(join(app.getPath('userData'), 'config.json'), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Your config.json could not be read. See the setup instructions.')
  }
  const clientId = process.env.AZURE_CLIENT_ID || settings.clientId
  const tenant = process.env.AZURE_TENANT_ID || settings.tenantId || 'organizations'
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (
    !clientId ||
    !uuid.test(clientId) ||
    !(uuid.test(tenant) || ['common', 'organizations', 'consumers'].includes(tenant))
  ) {
    throw new Error(
      'Microsoft sign-in is not configured. Set AZURE_CLIENT_ID and AZURE_TENANT_ID in .env, or create config.json as described in the README.'
    )
  }
  return { clientId, authority: `https://login.microsoftonline.com/${tenant}` }
}

export const GRAPH_SCOPES = ['Mail.Read']
export const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'
