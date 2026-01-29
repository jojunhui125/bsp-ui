/**
 * 사이드바 컴포넌트
 * 탭 전환: Explorer / Layers / Search / Build 등
 */

import { useEffect, useMemo, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSshStore } from '../../stores/sshStore'
import { useBuildStore } from '../../stores/buildStore'
import { FileExplorer } from '../panels/FileExplorer'
import { ServerFileExplorer } from '../panels/ServerFileExplorer'
import { LayersPanel } from '../panels/LayersPanel'
import { GlobalSearchViewer } from '../viewers/GlobalSearchViewer'

type SidebarTab = 'explorer' | 'layers' | 'search' | 'build'

interface TabConfig {
  id: SidebarTab
  icon: string
  label: string
}

const tabs: TabConfig[] = [
  { id: 'explorer', icon: '📁', label: '탐색기' },
  { id: 'layers', icon: '📚', label: '레이어' },
  { id: 'search', icon: '🔍', label: '검색' },
  { id: 'build', icon: '🔨', label: '빌드' },
]

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('explorer')
  const { serverProject, currentProject } = useProjectStore()
  const { connectionStatus } = useSshStore()

  // 서버 연결 시 서버 탐색기, 아니면 로컬 탐색기
  const isServerMode = connectionStatus.connected && serverProject

  return (
    <div className="flex h-full">
      {/* 아이콘 탭 바 */}
      <div className="flex flex-col w-12 bg-ide-bg border-r border-ide-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              flex items-center justify-center w-12 h-12
              text-lg transition-colors relative
              ${activeTab === tab.id
                ? 'text-ide-text border-l-2 border-ide-accent bg-ide-sidebar'
                : 'text-ide-text-muted hover:text-ide-text'
              }
            `}
            title={tab.label}
          >
            {tab.icon}
            {/* 서버 연결 표시 */}
            {tab.id === 'explorer' && isServerMode && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-ide-success rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* 탭 컨텐츠 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between h-9 px-4 bg-ide-sidebar border-b border-ide-border">
          <span className="text-xs font-semibold uppercase tracking-wider text-ide-text-muted">
            {tabs.find((t) => t.id === activeTab)?.label}
          </span>
          {isServerMode && activeTab === 'explorer' && (
            <span className="text-xs text-ide-success">🖥️ 서버</span>
          )}
        </div>

        {/* 컨텐츠 */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'explorer' && (
            isServerMode ? <ServerFileExplorer /> : <FileExplorer />
          )}
          {activeTab === 'layers' && <LayersPanel />}
          {activeTab === 'search' && <GlobalSearchViewer />}
          {activeTab === 'build' && <BuildPanel />}
        </div>
      </div>
    </div>
  )
}

// 빌드 패널
function BuildPanel() {
  const { connectionStatus, activeProfile } = useSshStore()
  const { serverProject } = useProjectStore()
  const {
    config,
    setConfig,
    logs,
    status,
    isBuilding,
    isStopping,
    error,
    startBuild,
    stopBuild,
    clearLogs,
    refreshStatus,
    _setupListeners,
  } = useBuildStore()

  const { hasConnection, hasProject, canBuild } = useMemo(() => {
    const connected = Boolean(connectionStatus.connected && activeProfile)
    const projectReady = Boolean(serverProject)
    return {
      hasConnection: connected,
      hasProject: projectReady,
      canBuild: connected && projectReady,
    }
  }, [connectionStatus.connected, activeProfile, serverProject])

  useEffect(() => {
    const unsubscribe = _setupListeners()
    void refreshStatus()
    return () => unsubscribe()
  }, [_setupListeners, refreshStatus])

  const handleStart = async () => {
    if (!activeProfile || !serverProject) return
    await startBuild({
      serverId: activeProfile.id,
      projectPath: serverProject.path,
    })
  }

  const handleStop = async () => {
    if (!activeProfile) return
    await stopBuild(activeProfile.id)
  }

  return (
    <div className="flex h-full flex-col p-4 text-sm text-ide-text">
      {!canBuild && (
        <div className="text-ide-text-muted">
          {!hasConnection ? '서버에 연결해주세요' : '서버 프로젝트를 선택해주세요'}
        </div>
      )}

      {canBuild && (
        <>
          <div className="mb-3 text-xs text-ide-text-muted">
            Project: <span className="font-mono text-ide-text">{serverProject?.path}</span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-ide-text-muted mb-1">Build Dir</label>
              <input
                className="w-full px-2 py-1 bg-ide-hover border border-ide-border rounded text-ide-text"
                value={config.buildDir}
                onChange={(e) => setConfig({ buildDir: e.target.value })}
                placeholder="build"
              />
            </div>

            <div>
              <label className="block text-xs text-ide-text-muted mb-1">Image</label>
              <input
                className="w-full px-2 py-1 bg-ide-hover border border-ide-border rounded text-ide-text"
                value={config.image}
                onChange={(e) => setConfig({ image: e.target.value })}
                placeholder="core-image-minimal"
              />
            </div>

            <div>
              <label className="block text-xs text-ide-text-muted mb-1">Machine (optional)</label>
              <input
                className="w-full px-2 py-1 bg-ide-hover border border-ide-border rounded text-ide-text"
                value={config.machine}
                onChange={(e) => setConfig({ machine: e.target.value })}
                placeholder="(use local.conf)"
              />
            </div>

            <div>
              <label className="block text-xs text-ide-text-muted mb-1">Extra Args (optional)</label>
              <input
                className="w-full px-2 py-1 bg-ide-hover border border-ide-border rounded text-ide-text"
                value={config.extraArgs}
                onChange={(e) => setConfig({ extraArgs: e.target.value })}
                placeholder="-k"
              />
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={handleStart}
              disabled={!canBuild || isBuilding || isStopping}
              className="flex-1 px-3 py-2 bg-ide-accent text-white rounded disabled:opacity-50"
            >
              {isBuilding ? 'Running...' : 'Start Build'}
            </button>
            <button
              onClick={handleStop}
              disabled={!isBuilding || isStopping}
              className="px-3 py-2 bg-ide-hover border border-ide-border rounded text-ide-text-muted disabled:opacity-50"
            >
              {isStopping ? 'Stopping...' : 'Stop'}
            </button>
            <button
              onClick={clearLogs}
              className="px-3 py-2 bg-ide-hover border border-ide-border rounded text-ide-text-muted"
            >
              Clear
            </button>
          </div>

          {error && (
            <div className="mt-3 text-xs text-ide-error">
              {error}
            </div>
          )}

          <div className="mt-3 text-xs text-ide-text-muted">
            Status: {status?.job?.status ?? 'idle'}
            {status?.lastExitCode !== undefined && (
              <span className="ml-2">Exit: {status.lastExitCode}</span>
            )}
          </div>

          <div className="mt-3 flex-1 overflow-hidden">
            <div className="h-full rounded border border-ide-border bg-ide-hover/30 p-2 overflow-auto font-mono text-xs whitespace-pre-wrap">
              {logs.length === 0 ? 'No logs yet.' : logs.join('')}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
