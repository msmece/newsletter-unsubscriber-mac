import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'node:url'
import type { IpcMainInvokeEvent } from 'electron'
import { validateFolders, validateCandidate } from './validation'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { acquireToken, getActiveAccount, signOut } from './auth'
import { getMailboxFolders, scanFolders } from './graph'
import {
  getActivity,
  onActivity,
  clearActivity,
  openExternalWithActivity,
  beginActivity
} from './activity'
import { unsubscribe } from './unsubscribe'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 760,
    minHeight: 580,
    backgroundColor: '#f7f8fa',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  )
  mainWindow.webContents.session.setPermissionCheckHandler(() => false)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void openExternalWithActivity(details.url).catch(() => {})
    return { action: 'deny' }
  })

  const stopActivity = onActivity((entries) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.send('activity:updated', entries)
  })
  mainWindow.on('closed', stopActivity)

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, value: unknown) => unknown
): void {
  ipcMain.handle(channel, (event, value: unknown) => {
    const frame = event.senderFrame
    const expected =
      is.dev && process.env.ELECTRON_RENDERER_URL
        ? process.env.ELECTRON_RENDERER_URL
        : pathToFileURL(join(__dirname, '../renderer/index.html')).href
    const actual = frame?.url
    if (
      !frame ||
      frame !== event.sender.mainFrame ||
      !actual ||
      new URL(actual).href !== new URL(expected).href
    )
      throw new Error('Untrusted application request.')
    return listener(event, value)
  })
}

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('io.github.msmece.newsletter-unsubscriber')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  handle('activity:list', () => getActivity())
  handle('activity:clear', () => clearActivity())
  handle('auth:getAccount', () => getActiveAccount())
  handle('auth:login', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const finish = beginActivity(
      'Connect your Microsoft account',
      'Microsoft identity service',
      'Sign-in'
    )
    try {
      const account = await acquireToken((info) => win?.webContents.send('auth:device-code', info))
      finish('success', 'Your account is connected. The app can read your mail folders.')
      return account
    } catch (error) {
      finish('failed', 'Sign-in was not completed. Please try connecting again.')
      throw error
    }
  })
  handle('auth:logout', () => signOut())
  handle('mail:listFolders', () => getMailboxFolders())
  handle('mail:scan', (event, folders) => {
    validateFolders(folders)
    const win = BrowserWindow.fromWebContents(event.sender)
    return scanFolders(folders, (message) => win?.webContents.send('mail:scan-progress', message))
  })
  handle('mail:unsubscribe', (_event, candidate) => {
    validateCandidate(candidate)
    return unsubscribe(candidate)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
