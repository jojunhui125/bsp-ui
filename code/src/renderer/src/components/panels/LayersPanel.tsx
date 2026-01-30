/**
 * 레이어 패널
 * Yocto 레이어 목록 및 우선순위 표시
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSshStore } from '../../stores/sshStore'
import { useBuildStore } from '../../stores/buildStore'
import { useEditorStore, FileTreeNode } from '../../stores/editorStore'
import { toast } from '../layout/Toast'

interface LayerEntry {
  name: string
  path: string
  priority: number
}

const expandVars = (input: string, vars: Record<string, string>) =>
  input.replace(/\$\{([^}]+)\}/g, (match, key) => vars[key] ?? match)

const normalizePosixPath = (input: string) => {
  const parts = input.split('/').filter(Boolean)
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return `/${stack.join('/')}`
}

const toLayerName = (path: string) => {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

const quoteForShell = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`

export function LayersPanel() {
  const { currentProject, serverProject, bspMachine } = useProjectStore()
  const { connectionStatus, activeProfile } = useSshStore()
  const { config } = useBuildStore()
  const { openFile, setFileTree, setFileTreeLoading } = useEditorStore()
  const [serverLayers, setServerLayers] = useState<LayerEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvedBuildDir, setResolvedBuildDir] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; layer: LayerEntry } | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const serverMode = Boolean(serverProject)
  const layers = currentProject?.layers ?? serverLayers
  const hasPriority = layers.some((layer) => layer.priority !== 0)
  const sortedLayers = useMemo(() => {
    if (!hasPriority) return layers
    return [...layers].sort((a, b) => b.priority - a.priority)
  }, [hasPriority, layers])

  useEffect(() => {
    const loadServerLayers = async () => {
      if (!serverProject || !activeProfile || !connectionStatus.connected) return
      setLoading(true)
      setError(null)
      setResolvedBuildDir(null)

      try {
        const rawBuildDir = config.buildDir.trim()
        const candidateDirs: string[] = []
        if (rawBuildDir) {
          candidateDirs.push(rawBuildDir)
        }
        if (bspMachine) {
          candidateDirs.push(`build_${bspMachine}`)
        }
        candidateDirs.push('build')

        try {
          const listCmd = `cd ${quoteForShell(serverProject.path)} && ls -1d build_* 2>/dev/null`
          const listResult = await window.electronAPI.ssh.exec(
            activeProfile.id,
            `bash -lc ${quoteForShell(listCmd)}`
          )
          const extra = listResult.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
          candidateDirs.push(...extra)
        } catch {
          // ignore list failures
        }

        const buildDirs = Array.from(new Set(candidateDirs.filter(Boolean)))
        let content = ''
        let selectedBuildDir = ''

        for (const dir of buildDirs) {
          try {
            const bblayersPath = `${serverProject.path}/${dir}/conf/bblayers.conf`
            content = await window.electronAPI.ssh.readFile(activeProfile.id, bblayersPath)
            selectedBuildDir = dir
            break
          } catch {
            // try next candidate
          }
        }

        if (!content) {
          throw new Error(`bblayers.conf not found (tried: ${buildDirs.join(', ')})`)
        }

        setResolvedBuildDir(selectedBuildDir)

        const tokens = Array.from(
          content.matchAll(/(?:\$\{[^}]+\}|\/)[^\s"'\\]+/g)
        ).map((match) => match[0].replace(/['"\\]/g, '').trim())

        const topDir = `${serverProject.path}/${selectedBuildDir}`
        const vars = {
          TOPDIR: topDir,
          BSPDIR: serverProject.path,
        }

        const layerPaths = tokens
          .map((token) => expandVars(token, vars))
          .map((token) => (token.startsWith('/') ? token : `${topDir}/${token}`))
          .map((token) => normalizePosixPath(token))

        const unique = Array.from(new Set(layerPaths))
        const layerMeta = await Promise.all(
          unique.map(async (path) => {
            try {
              const layerConfPath = `${path}/conf/layer.conf`
              const layerConf = await window.electronAPI.ssh.readFile(
                activeProfile.id,
                layerConfPath
              )
              const match = layerConf.match(/^\s*BBFILE_PRIORITY(?:_[A-Za-z0-9_-]+)?\s*=\s*"?(\d+)"?/m)
              return {
                name: toLayerName(path),
                path,
                priority: match ? Number(match[1]) : 0,
              }
            } catch {
              return {
                name: toLayerName(path),
                path,
                priority: 0,
              }
            }
          })
        )

        setServerLayers(layerMeta)
      } catch (err) {
        const message = err instanceof Error ? err.message : '레이어 로드 실패'
        setError(message)
      } finally {
        setLoading(false)
      }
    }

    void loadServerLayers()
  }, [serverProject?.path, activeProfile?.id, connectionStatus.connected, config.buildDir, bspMachine])

  useEffect(() => {
    if (!menu) return
    const handleClick = () => setMenu(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null)
      }
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('contextmenu', handleClick)
    window.addEventListener('scroll', handleClick, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('contextmenu', handleClick)
      window.removeEventListener('scroll', handleClick, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [menu])

  useEffect(() => {
    if (!menu) {
      setMenuPosition(null)
      return
    }

    const updatePosition = () => {
      if (!menuRef.current) return
      const { offsetWidth, offsetHeight } = menuRef.current
      const padding = 8
      const maxX = Math.max(padding, window.innerWidth - offsetWidth - padding)
      const maxY = Math.max(padding, window.innerHeight - offsetHeight - padding)
      const x = Math.max(padding, Math.min(menu.x, maxX))
      const y = Math.max(padding, Math.min(menu.y, maxY))
      setMenuPosition({ x, y })
    }

    const raf = requestAnimationFrame(updatePosition)
    return () => cancelAnimationFrame(raf)
  }, [menu])

  const loadDirectory = useCallback(async (path: string): Promise<FileTreeNode[]> => {
    if (!activeProfile || !connectionStatus.connected) return []

    try {
      const result = await window.electronAPI.ssh.exec(
        activeProfile.id,
        `ls -la "${path}" 2>/dev/null | tail -n +2`
      )

      if (result.code !== 0) return []

      const lines = result.stdout.trim().split('\n').filter(Boolean)
      const nodes: FileTreeNode[] = []

      for (const line of lines) {
        const parts = line.split(/\s+/)
        if (parts.length >= 9) {
          const perms = parts[0]
          const size = parseInt(parts[4]) || 0
          const name = parts.slice(8).join(' ')

          if (name === '.' || name === '..') continue

          const isDirectory = perms.startsWith('d')
          const fullPath = path === '/' ? `/${name}` : `${path}/${name}`

          nodes.push({
            name,
            path: fullPath,
            isDirectory,
            size,
            permissions: perms,
          })
        }
      }

      nodes.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })

      return nodes
    } catch {
      return []
    }
  }, [activeProfile, connectionStatus.connected])

  const openLayerConfig = useCallback(async (layer: LayerEntry) => {
    if (!serverProject || !activeProfile || !connectionStatus.connected) return
    const filePath = `${layer.path}/conf/layer.conf`
    try {
      const content = await window.electronAPI.ssh.readFile(activeProfile.id, filePath)
      openFile({
        path: filePath,
        name: 'layer.conf',
        content,
        isDirty: false,
        isLoading: false,
        serverId: activeProfile.id,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'layer.conf 열기 실패'
      setError(message)
    }
  }, [activeProfile, connectionStatus.connected, openFile, serverProject])

  const openLayerDirectory = useCallback(async (layer: LayerEntry) => {
    if (!serverProject || !activeProfile || !connectionStatus.connected) return
    setFileTreeLoading(true)
    try {
      const nodes = await loadDirectory(layer.path)
      setFileTree(nodes, layer.path)
    } catch (err) {
      const message = err instanceof Error ? err.message : '디렉토리를 열 수 없습니다'
      setError(message)
    } finally {
      setFileTreeLoading(false)
    }
  }, [activeProfile, connectionStatus.connected, loadDirectory, serverProject, setFileTree, setFileTreeLoading])

  const openLayerDirectoryInExplorer = useCallback((layer: LayerEntry) => {
    window.dispatchEvent(new CustomEvent('bsp-sidebar-tab', { detail: 'explorer' }))
    void openLayerDirectory(layer)
  }, [openLayerDirectory])

  const copyLayerPath = useCallback(async (layer: LayerEntry) => {
    try {
      await navigator.clipboard.writeText(layer.path)
      toast.success('경로 복사됨', layer.path)
    } catch {
      setError('경로 복사 실패')
      toast.error('경로 복사 실패', '클립보드에 복사할 수 없습니다.')
    }
  }, [])

  if (!currentProject && !serverProject) {
    return (
      <div className="p-4 text-sm text-ide-text-muted">
        <p>프로젝트를 먼저 열어주세요.</p>
      </div>
    )
  }

  if (serverMode && loading) {
    return (
      <div className="p-4 text-sm text-ide-text-muted">
        <p>레이어를 불러오는 중...</p>
      </div>
    )
  }

  if (serverMode && error) {
    return (
      <div className="p-4 text-sm text-ide-error">
        <p>레이어 로드 실패: {error}</p>
      </div>
    )
  }

  if (layers.length === 0) {
    return (
      <div className="p-4 text-sm text-ide-text-muted">
        <p>레이어가 감지되지 않았습니다.</p>
        <p className="mt-2 text-xs">bblayers.conf 파일을 확인해주세요.</p>
      </div>
    )
  }

  return (
    <div className="p-2">
      <div className="mb-2 flex items-center justify-between text-xs text-ide-text-muted">
        <span>
        {serverMode ? '서버 레이어' : '로컬 레이어'} {sortedLayers.length}개
        {serverMode && resolvedBuildDir ? ` (${resolvedBuildDir})` : ''}
        </span>
        {serverMode && (
          <span>
            {loading ? '로딩 중...' : '로드 완료'}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {sortedLayers.map((layer, index) => (
          <LayerItem
            key={layer.path}
            layer={layer}
            index={index}
            onOpen={() => {
              setMenu(null)
              void openLayerConfig(layer)
            }}
            onOpenDirectory={(event) => {
              event.preventDefault()
              setMenu({ x: event.clientX, y: event.clientY, layer })
            }}
          />
        ))}
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[180px] rounded border border-ide-border bg-ide-sidebar shadow-lg text-xs"
          style={{ left: menuPosition?.x ?? menu.x, top: menuPosition?.y ?? menu.y }}
        >
          <button
            className="w-full px-3 py-2 text-left hover:bg-ide-hover"
            onClick={() => {
              setMenu(null)
              void openLayerConfig(menu.layer)
            }}
          >
            layer.conf 열기
          </button>
          <button
            className="w-full px-3 py-2 text-left hover:bg-ide-hover"
            onClick={() => {
              setMenu(null)
              openLayerDirectoryInExplorer(menu.layer)
            }}
          >
            탐색기에서 열기
          </button>
          <button
            className="w-full px-3 py-2 text-left hover:bg-ide-hover"
            onClick={() => {
              setMenu(null)
              void copyLayerPath(menu.layer)
            }}
          >
            경로 복사
          </button>
        </div>
      )}
    </div>
  )
}

interface LayerItemProps {
  layer: { name: string; path: string; priority: number }
  index: number
  onOpen: () => void
  onOpenDirectory: (event: React.MouseEvent<HTMLButtonElement>) => void
}

function LayerItem({ layer, index, onOpen, onOpenDirectory }: LayerItemProps) {
  // 레이어 타입 분류
  const layerType = getLayerType(layer.name)

  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onOpenDirectory}
      className={`
        flex items-center justify-between p-2 rounded text-left w-full
        hover:bg-ide-hover transition-colors cursor-pointer
        ${layerType === 'vendor' ? 'border-l-2 border-ide-warning' : ''}
        ${layerType === 'custom' ? 'border-l-2 border-ide-success' : ''}
      `}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs text-ide-text-muted w-5">{index + 1}</span>
        <span className="text-lg">📚</span>
        <div className="min-w-0">
          <p className="text-sm font-mono text-ide-text truncate">{layer.name}</p>
          <p className="text-xs text-ide-text-muted truncate">{layer.path}</p>
        </div>
      </div>
      
      <div className="flex items-center gap-2 ml-2">
        <span className={`
          px-1.5 py-0.5 rounded text-xs
          ${layerType === 'core' ? 'bg-ide-accent/20 text-ide-accent' : ''}
          ${layerType === 'vendor' ? 'bg-ide-warning/20 text-ide-warning' : ''}
          ${layerType === 'custom' ? 'bg-ide-success/20 text-ide-success' : ''}
          ${layerType === 'bsp' ? 'bg-purple-500/20 text-purple-400' : ''}
        `}>
          {layerType}
        </span>
        <span className="text-xs text-ide-text-muted">P:{layer.priority}</span>
      </div>
    </button>
  )
}

/**
 * 레이어 이름으로 타입 추정
 */
function getLayerType(name: string): 'core' | 'vendor' | 'bsp' | 'custom' {
  const lowerName = name.toLowerCase()
  
  if (lowerName.includes('poky') || lowerName === 'meta' || lowerName.includes('oe-core')) {
    return 'core'
  }
  if (lowerName.includes('bsp') || lowerName.includes('board')) {
    return 'bsp'
  }
  if (
    lowerName.includes('vendor') ||
    lowerName.includes('nxp') ||
    lowerName.includes('alb') ||
    lowerName.includes('freescale')
  ) {
    return 'vendor'
  }
  if (lowerName.includes('local') || lowerName.includes('custom')) {
    return 'custom'
  }
  return 'custom'
}
