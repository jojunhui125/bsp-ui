/**
 * Preload Script
 * Main/Renderer 媛??덉쟾??API 釉뚮━吏
 */

import { contextBridge, ipcRenderer } from 'electron'
import {
  FILE_CHANNELS,
  WINDOW_CHANNELS,
  PROJECT_CHANNELS,
  SSH_CHANNELS,
  BUILD_CHANNELS,
  INDEX_CHANNELS,
  LSP_CHANNELS,
  CACHE_CHANNELS,
} from '../shared/ipc-channels'
import type { FileContent, FileTreeNode, ProjectInfo, ServerProfile, ConnectionStatus, SshReadFileResult, BuildStartRequest, BuildStatus, BuildLogEvent } from '../shared/types'

// ============================================
// API ?뺤쓽
// ============================================

/**
 * ?뚯씪 ?쒖뒪??API
 */
const fileApi = {
  readFile: (path: string): Promise<FileContent> =>
    ipcRenderer.invoke(FILE_CHANNELS.READ_FILE, path),
    
  writeFile: (path: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke(FILE_CHANNELS.WRITE_FILE, path, content),
    
  readDir: (path: string): Promise<string[]> =>
    ipcRenderer.invoke(FILE_CHANNELS.READ_DIR, path),
    
  getFileTree: (rootPath: string): Promise<FileTreeNode[]> =>
    ipcRenderer.invoke(FILE_CHANNELS.GET_FILE_TREE, rootPath),
}

/**
 * ?덈룄???쒖뼱 API
 */
const windowApi = {
  minimize: (): void => ipcRenderer.send(WINDOW_CHANNELS.MINIMIZE),
  maximize: (): void => ipcRenderer.send(WINDOW_CHANNELS.MAXIMIZE),
  close: (): void => ipcRenderer.send(WINDOW_CHANNELS.CLOSE),
  isMaximized: (): Promise<boolean> =>
    ipcRenderer.invoke(WINDOW_CHANNELS.IS_MAXIMIZED),
}

/**
 * ?꾨줈?앺듃 API
 */
const projectApi = {
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(PROJECT_CHANNELS.SELECT_FOLDER),
    
  openProject: (path: string): Promise<ProjectInfo> =>
    ipcRenderer.invoke(PROJECT_CHANNELS.OPEN_PROJECT, path),
    
  getInfo: (path: string): Promise<ProjectInfo | null> =>
    ipcRenderer.invoke(PROJECT_CHANNELS.GET_INFO, path),
}

/**
 * SSH API
 */
const sshApi = {
  // ?곌껐 愿由?
  connect: (profile: ServerProfile): Promise<ConnectionStatus> =>
    ipcRenderer.invoke(SSH_CHANNELS.CONNECT, profile),
    
  disconnect: (serverId: string): Promise<void> =>
    ipcRenderer.invoke(SSH_CHANNELS.DISCONNECT, serverId),
    
  isConnected: (serverId: string): Promise<boolean> =>
    ipcRenderer.invoke(SSH_CHANNELS.IS_CONNECTED, serverId),
    
  testConnection: (profile: ServerProfile): Promise<{ success: boolean; info?: string; error?: string }> =>
    ipcRenderer.invoke(SSH_CHANNELS.TEST_CONNECTION, profile),

  // 紐낅졊 ?ㅽ뻾
  exec: (serverId: string, command: string): Promise<{ stdout: string; stderr: string; code: number }> =>
    ipcRenderer.invoke(SSH_CHANNELS.EXEC, serverId, command),
    
  execStream: (serverId: string, command: string): Promise<number> =>
    ipcRenderer.invoke(SSH_CHANNELS.EXEC_STREAM, serverId, command),

  // ?뚯씪 ?쒖뒪??(SFTP)
  readDir: (serverId: string, remotePath: string): Promise<string[]> =>
    ipcRenderer.invoke(SSH_CHANNELS.READ_DIR, serverId, remotePath),
    
  readFile: async (serverId: string, remotePath: string): Promise<string> => {
    const result = await ipcRenderer.invoke(
      SSH_CHANNELS.READ_FILE,
      serverId,
      remotePath
    ) as SshReadFileResult

    if (!result?.ok) {
      const error = new Error(result?.error || 'Failed to read file')
      ;(error as any).code = result?.code
      throw error
    }

    return result.content ?? ''
  },
    
  writeFile: (serverId: string, remotePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke(SSH_CHANNELS.WRITE_FILE, serverId, remotePath, content),

  // ?ㅼ씠?쇰줈洹?
  selectKeyFile: (): Promise<string | null> =>
    ipcRenderer.invoke(SSH_CHANNELS.SELECT_KEY_FILE),

  // ?대깽??由ъ뒪??
  onStatusChanged: (callback: (data: { serverId: string; connected: boolean; error?: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on(SSH_CHANNELS.STATUS_CHANGED, handler)
    return () => ipcRenderer.removeListener(SSH_CHANNELS.STATUS_CHANGED, handler)
  },

  onStreamData: (callback: (data: { type: 'stdout' | 'stderr'; data: string }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on(SSH_CHANNELS.STREAM_DATA, handler)
    return () => ipcRenderer.removeListener(SSH_CHANNELS.STREAM_DATA, handler)
  },
}

/**
 * Build API
 */
const buildApi = {
  start: (request: BuildStartRequest): Promise<BuildStatus> =>
    ipcRenderer.invoke(BUILD_CHANNELS.START_BUILD, request),

  stop: (serverId: string): Promise<boolean> =>
    ipcRenderer.invoke(BUILD_CHANNELS.STOP_BUILD, serverId),

  getStatus: (): Promise<BuildStatus> =>
    ipcRenderer.invoke(BUILD_CHANNELS.GET_STATUS),

  onLog: (callback: (event: BuildLogEvent) => void) => {
    const handler = (_event: any, data: BuildLogEvent) => callback(data)
    ipcRenderer.on(BUILD_CHANNELS.ON_LOG, handler)
    return () => ipcRenderer.removeListener(BUILD_CHANNELS.ON_LOG, handler)
  },

  onStatusChanged: (callback: (status: BuildStatus) => void) => {
    const handler = (_event: any, data: BuildStatus) => callback(data)
    ipcRenderer.on(BUILD_CHANNELS.STATUS_CHANGED, handler)
    return () => ipcRenderer.removeListener(BUILD_CHANNELS.STATUS_CHANGED, handler)
  },
}


/**
 * ?몃뜳??API (SQLite + FTS5)
 */
const indexApi = {
  // ?몃뜳???쒖옉 (利앸텇)
  startIndex: (projectPath: string, serverId: string, fullReindex?: boolean): Promise<boolean> =>
    ipcRenderer.invoke(INDEX_CHANNELS.START_INDEX, projectPath, serverId, fullReindex),
  
  // ?몃뜳??痍⑥냼
  cancelIndex: (): Promise<boolean> =>
    ipcRenderer.invoke(INDEX_CHANNELS.CANCEL_INDEX),
  
  // ?몃뜳???곹깭 議고쉶
  getStatus: (): Promise<{ isIndexing: boolean; projectPath: string }> =>
    ipcRenderer.invoke(INDEX_CHANNELS.GET_STATUS),
  
  // ?몃뜳???듦퀎 議고쉶
  getStats: (): Promise<{ files: number; symbols: number; includes: number; dtNodes: number; gpioPins: number; lastIndexTime: string | null }> =>
    ipcRenderer.invoke(INDEX_CHANNELS.GET_STATS),
  
  // ?몃뜳??珥덇린??
  clearIndex: (): Promise<boolean> =>
    ipcRenderer.invoke(INDEX_CHANNELS.CLEAR_INDEX),
  
  // 吏꾪뻾瑜??대깽??
  onProgress: (callback: (progress: { phase: string; current: number; total: number; message: string; speed?: number }) => void) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on(INDEX_CHANNELS.PROGRESS, handler)
    return () => ipcRenderer.removeListener(INDEX_CHANNELS.PROGRESS, handler)
  },

  // ?쒕쾭???몃뜳?????(? 怨듭쑀??
  saveToServer: (serverId: string, projectPath: string): Promise<boolean> =>
    ipcRenderer.invoke('index:saveToServer', serverId, projectPath),

  // ?쒕쾭?먯꽌 ?몃뜳??濡쒕뱶 (? 怨듭쑀??
  loadFromServer: (serverId: string, projectPath: string): Promise<boolean> =>
    ipcRenderer.invoke('index:loadFromServer', serverId, projectPath),

  // ?쒕쾭 ?몃뜳??硫뷀??곗씠??議고쉶
  getServerMeta: (serverId: string, projectPath: string): Promise<{
    exists: boolean
    lastSaved?: string
    savedBy?: string
    stats?: { files: number; symbols: number }
  }> => ipcRenderer.invoke('index:getServerMeta', serverId, projectPath),

  // ?? ?쒕쾭 痢??몃뜳??(?듯룺?꾧툒 ?깅뒫!)
  serverSideIndex: (projectPath: string, serverId: string): Promise<boolean> =>
    ipcRenderer.invoke('index:serverSide', projectPath, serverId),

  // Python ?ъ슜 媛???щ? ?뺤씤
  checkPython: (serverId: string): Promise<{ available: boolean; version?: string }> =>
    ipcRenderer.invoke('index:checkPython', serverId),
}

/**
 * LSP API (Language Server Protocol)
 */
const lspApi = {
  // Go to Definition
  goToDefinition: (filePath: string, content: string, line: number, character: number): Promise<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } } | null> =>
    ipcRenderer.invoke(LSP_CHANNELS.GO_TO_DEFINITION, filePath, content, line, character),
  
  // Find References
  findReferences: (filePath: string, content: string, line: number, character: number): Promise<Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>> =>
    ipcRenderer.invoke(LSP_CHANNELS.FIND_REFERENCES, filePath, content, line, character),
  
  // Get Hover
  getHover: (filePath: string, content: string, line: number, character: number): Promise<{ contents: { kind: string; value: string }; range?: any } | null> =>
    ipcRenderer.invoke(LSP_CHANNELS.GET_HOVER, filePath, content, line, character),
  
  // Get Completions
  getCompletions: (filePath: string, content: string, line: number, character: number): Promise<Array<{ label: string; kind: number; detail?: string; documentation?: string; insertText?: string }>> =>
    ipcRenderer.invoke(LSP_CHANNELS.GET_COMPLETIONS, filePath, content, line, character),
  
  // Search Symbols (FTS5 ?꾨Ц 寃??
  searchSymbols: (query: string, limit?: number): Promise<Array<{ name: string; value: string; type: string; file_path: string; line: number }>> =>
    ipcRenderer.invoke(LSP_CHANNELS.SEARCH_SYMBOLS, query, limit),
  
  // Find Definition by name
  findDefinition: (symbolName: string): Promise<{ name: string; value: string; type: string; file_path: string; line: number } | null> =>
    ipcRenderer.invoke(LSP_CHANNELS.FIND_DEFINITION, symbolName),
  
  // Search Files (?뚯씪/寃쎈줈 寃??
  searchFiles: (query: string, limit?: number): Promise<Array<{ path: string; name: string; type: string }>> =>
    ipcRenderer.invoke(LSP_CHANNELS.SEARCH_FILES, query, limit),
  
  // Directory Exists (?붾젆?좊━ 議댁옱 ?뺤씤)
  directoryExists: (dirPath: string): Promise<boolean> =>
    ipcRenderer.invoke(LSP_CHANNELS.DIRECTORY_EXISTS, dirPath),
}

/**
 * 罹먯떆 API (LRU Cache)
 */
const cacheApi = {
  // 罹먯떆 ?듦퀎 議고쉶
  getStats: (): Promise<Record<string, { size: number; entries: number; maxSize: number; maxEntries: number; hits: number; misses: number; hitRate: number }>> =>
    ipcRenderer.invoke(CACHE_CHANNELS.GET_STATS),
  
  // 罹먯떆 珥덇린??
  clear: (): Promise<boolean> =>
    ipcRenderer.invoke(CACHE_CHANNELS.CLEAR),
}

// ============================================
// API ?몄텧
// ============================================

/**
 * window.electronAPI濡?Renderer?먯꽌 ?묎렐 媛??
 */
const electronAPI = {
  file: fileApi,
  window: windowApi,
  project: projectApi,
  ssh: sshApi,
  build: buildApi,
  // ?덈줈??怨좎꽦??API
  index: indexApi,
  lsp: lspApi,
  cache: cacheApi,
}

// ????좎뼵 (TypeScript 吏??
export type ElectronAPI = typeof electronAPI

// Context Bridge濡??덉쟾?섍쾶 ?몄텧
contextBridge.exposeInMainWorld('electronAPI', electronAPI)
