/**
 * Build 상태 스토어
 */

import { create } from 'zustand'
import type { BuildStartRequest, BuildStatus, BuildLogEvent } from '@shared/types'

interface BuildConfig {
  buildDir: string
  image: string
  machine: string
  extraArgs: string
}

interface BuildState {
  // 상태
  status: BuildStatus | null
  isBuilding: boolean
  isStopping: boolean
  logs: string[]
  config: BuildConfig
  error: string | null

  // 액션
  startBuild: (request: Omit<BuildStartRequest, 'buildDir' | 'image' | 'machine' | 'extraArgs'>) => Promise<void>
  stopBuild: (serverId: string) => Promise<void>
  clearLogs: () => void
  setConfig: (patch: Partial<BuildConfig>) => void
  refreshStatus: () => Promise<void>

  // 내부
  _appendLog: (event: BuildLogEvent) => void
  _setupListeners: () => () => void
}

const DEFAULT_CONFIG: BuildConfig = {
  buildDir: 'build',
  image: '',
  machine: '',
  extraArgs: '',
}

export const useBuildStore = create<BuildState>((set, get) => ({
  status: null,
  isBuilding: false,
  isStopping: false,
  logs: [],
  config: DEFAULT_CONFIG,
  error: null,

  startBuild: async (request) => {
    set({ error: null })
    const { config } = get()

    const payload: BuildStartRequest = {
      ...request,
      buildDir: config.buildDir.trim() || 'build',
      image: config.image.trim() || 'core-image-minimal',
      machine: config.machine.trim() || undefined,
      extraArgs: config.extraArgs.trim() || undefined,
    }

    try {
      const status = await window.electronAPI.build.start(payload)
      set({ status, isBuilding: status.isBuilding, isStopping: false })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Build start failed'
      set({ error: message, isBuilding: false })
      throw err
    }
  },

  stopBuild: async (serverId) => {
    set({ isStopping: true })
    try {
      await window.electronAPI.build.stop(serverId)
    } finally {
      set({ isStopping: false })
    }
  },

  clearLogs: () => {
    set({ logs: [] })
  },

  setConfig: (patch) => {
    set((state) => ({ config: { ...state.config, ...patch } }))
  },

  refreshStatus: async () => {
    const status = await window.electronAPI.build.getStatus()
    set({ status, isBuilding: status.isBuilding })
  },

  _appendLog: (event) => {
    const prefix = event.type === 'stderr' ? '[stderr] ' : ''
    const line = `${prefix}${event.data}`
    set((state) => ({
      logs: [...state.logs.slice(-4000), line],
    }))
  },

  _setupListeners: () => {
    const unsubscribeLog = window.electronAPI.build.onLog((event) => {
      get()._appendLog(event)
    })

    const unsubscribeStatus = window.electronAPI.build.onStatusChanged((status) => {
      set({ status, isBuilding: status.isBuilding })
    })

    return () => {
      unsubscribeLog()
      unsubscribeStatus()
    }
  },
}))
