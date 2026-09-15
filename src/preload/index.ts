import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  ActivityEntry,
  AccountInfo,
  DeviceCodeInfo,
  MailboxFolder,
  NewsletterCandidate,
  ScanResult,
  UnsubscribeOutcome
} from '../shared/types'

// Custom APIs for renderer
const api = {
  activity: {
    list: (): Promise<ActivityEntry[]> => ipcRenderer.invoke('activity:list'),
    clear: (): Promise<void> => ipcRenderer.invoke('activity:clear'),
    onUpdated: (callback: (entries: ActivityEntry[]) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, entries: ActivityEntry[]): void =>
        callback(entries)
      ipcRenderer.on('activity:updated', listener)
      return () => ipcRenderer.removeListener('activity:updated', listener)
    }
  },
  auth: {
    getAccount: (): Promise<AccountInfo | null> => ipcRenderer.invoke('auth:getAccount'),
    login: (): Promise<AccountInfo> => ipcRenderer.invoke('auth:login'),
    logout: (): Promise<void> => ipcRenderer.invoke('auth:logout'),
    onDeviceCode: (callback: (info: DeviceCodeInfo) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, info: DeviceCodeInfo): void => callback(info)
      ipcRenderer.on('auth:device-code', listener)
      return () => ipcRenderer.removeListener('auth:device-code', listener)
    }
  },
  mail: {
    listFolders: (): Promise<MailboxFolder[]> => ipcRenderer.invoke('mail:listFolders'),
    scan: (folders: MailboxFolder[]): Promise<ScanResult> =>
      ipcRenderer.invoke('mail:scan', folders),
    onScanProgress: (callback: (message: string) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, message: string): void => callback(message)
      ipcRenderer.on('mail:scan-progress', listener)
      return () => ipcRenderer.removeListener('mail:scan-progress', listener)
    },
    unsubscribe: (candidate: NewsletterCandidate): Promise<UnsubscribeOutcome> =>
      ipcRenderer.invoke('mail:unsubscribe', candidate)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
