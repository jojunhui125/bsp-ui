/**
 * Build IPC 핸들러
 */

import { ipcMain, BrowserWindow } from 'electron'
import { BUILD_CHANNELS } from '../../shared/ipc-channels'
import { buildManager } from '../build/BuildManager'
import type { BuildStartRequest, BuildStatus, BuildLogEvent } from '../../shared/types'

let mainWindow: BrowserWindow | null = null

export function setBuildMainWindow(window: BrowserWindow): void {
  mainWindow = window
}

export function registerBuildHandlers(): void {
  ipcMain.handle(
    BUILD_CHANNELS.START_BUILD,
    async (_event, request: BuildStartRequest): Promise<BuildStatus> => {
      const job = await buildManager.startBuild(request)
      return { isBuilding: true, job }
    }
  )

  ipcMain.handle(
    BUILD_CHANNELS.STOP_BUILD,
    async (_event, serverId: string): Promise<boolean> => {
      return await buildManager.stopBuild(serverId)
    }
  )

  ipcMain.handle(
    BUILD_CHANNELS.GET_STATUS,
    async (): Promise<BuildStatus> => {
      return buildManager.getStatus()
    }
  )

  buildManager.on('log', (event: BuildLogEvent) => {
    mainWindow?.webContents.send(BUILD_CHANNELS.ON_LOG, event)
  })

  buildManager.on('status', (status: BuildStatus) => {
    mainWindow?.webContents.send(BUILD_CHANNELS.STATUS_CHANGED, status)
  })

  console.log('[IPC] Build handlers registered')
}
