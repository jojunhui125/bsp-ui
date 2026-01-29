/**
 * Build Manager
 * - 원격 bitbake 빌드 실행 및 상태/로그 관리
 */

import { EventEmitter } from 'events'
import { sshManager } from '../ssh/SshManager'
import type { BuildJob, BuildStartRequest, BuildStatus, BuildLogEvent } from '../../shared/types'

function quoteForShell(value: string): string {
  // POSIX single-quote escaping: ' -> '"'"'
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function assertSafeInput(name: string, value: string, pattern: RegExp): void {
  if (!pattern.test(value)) {
    throw new Error(`${name}에 허용되지 않은 문자가 포함되어 있습니다: "${value}"`)
  }
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export class BuildManager extends EventEmitter {
  private status: BuildStatus = { isBuilding: false, job: null }
  private activeJobId: string | null = null
  private activePidFile: string | null = null
  private cancelRequested = false

  getStatus(): BuildStatus {
    return this.status
  }

  async startBuild(request: BuildStartRequest): Promise<BuildJob> {
    if (this.status.isBuilding) {
      throw new Error('이미 빌드가 실행 중입니다')
    }

    const image = normalizeWhitespace(request.image || 'core-image-minimal')
    const buildDir = normalizeWhitespace(request.buildDir || 'build')
    const extraArgs = normalizeWhitespace(request.extraArgs || '')
    const machine = request.machine ? normalizeWhitespace(request.machine) : ''

    // 입력 검증 (쉘 인젝션 방지)
    assertSafeInput('image', image, /^[A-Za-z0-9._+\-:@/]+$/)
    assertSafeInput('buildDir', buildDir, /^[A-Za-z0-9._+\-@/]+$/)
    if (machine) {
      assertSafeInput('machine', machine, /^[A-Za-z0-9._+\-@/]+$/)
    }
    if (extraArgs) {
      // 공백/하이픈/언더스코어/점/슬래시/등호만 허용
      assertSafeInput('extraArgs', extraArgs, /^[A-Za-z0-9._+\-@/= ]+$/)
    }

    const jobId = `build-${Date.now()}`
    const pidFile = `/tmp/bsp-build-${jobId}.pid`
    const initLogFile = `/tmp/bsp-oeinit-${jobId}.log`

    const job: BuildJob = {
      id: jobId,
      project: request.projectPath,
      machine: machine || '(local.conf)',
      image,
      status: 'running',
      startTime: new Date().toISOString(),
      logPath: initLogFile,
    }

    this.status = { isBuilding: true, job }
    this.activeJobId = jobId
    this.activePidFile = pidFile
    this.cancelRequested = false
    this.emitStatus()

    this.emitLog({ type: 'system', data: `[BUILD] Starting: bitbake ${image} ${extraArgs}`.trim() })

    const command = this.buildCommand({
      ...request,
      image,
      buildDir,
      extraArgs,
      machine,
      pidFile,
      initLogFile,
    })

    // 비동기 실행 (IPC 응답 즉시 반환)
    void this.runBuild(jobId, request.serverId, command, job)

    return job
  }

  async stopBuild(serverId: string): Promise<boolean> {
    if (!this.status.isBuilding || !this.activePidFile || !this.activeJobId) {
      return false
    }

    this.cancelRequested = true
    this.emitLog({ type: 'system', data: '[BUILD] Cancel requested...' })

    const pidFile = this.activePidFile
    const killCmd = [
      `if [ -f ${quoteForShell(pidFile)} ]; then`,
      `  pid=$(cat ${quoteForShell(pidFile)});`,
      '  if [ -n "$pid" ]; then',
      '    kill -TERM "$pid" 2>/dev/null || true;',
      '    sleep 2;',
      '    kill -KILL "$pid" 2>/dev/null || true;',
      '  fi;',
      `  rm -f ${quoteForShell(pidFile)};`,
      '  echo "__BSP_KILLED__";',
      'else',
      '  echo "__BSP_NOPID__";',
      'fi'
    ].join(' ')

    await sshManager.exec(serverId, `bash -lc ${quoteForShell(killCmd)}`)
    return true
  }

  private async runBuild(jobId: string, serverId: string, command: string, job: BuildJob): Promise<void> {
    try {
      const exitCode = await sshManager.execStream(
        serverId,
        command,
        (data) => this.emitLog({ type: 'stdout', data }),
        (data) => this.emitLog({ type: 'stderr', data })
      )

      const wasCancelled = this.cancelRequested && this.activeJobId === jobId

      job.status = wasCancelled ? 'cancelled' : (exitCode === 0 ? 'success' : 'failed')
      job.endTime = new Date().toISOString()

      this.status = {
        isBuilding: false,
        job,
        lastExitCode: exitCode,
        lastError: exitCode === 0 ? undefined : `Build exited with code ${exitCode}`,
      }

      if (wasCancelled) {
        this.emitLog({ type: 'system', data: '[BUILD] Cancelled.' })
      } else if (exitCode === 0) {
        this.emitLog({ type: 'system', data: '[BUILD] Completed successfully.' })
      } else {
        this.emitLog({ type: 'system', data: `[BUILD] Failed (exit code ${exitCode}).` })
      }
    } catch (err: any) {
      job.status = this.cancelRequested ? 'cancelled' : 'failed'
      job.endTime = new Date().toISOString()
      this.status = {
        isBuilding: false,
        job,
        lastExitCode: -1,
        lastError: err?.message || 'Build failed',
      }
      this.emitLog({ type: 'system', data: `[BUILD] Error: ${err?.message || 'unknown'}` })
    } finally {
      this.activeJobId = null
      this.activePidFile = null
      this.cancelRequested = false
      this.emitStatus()
    }
  }

  private buildCommand(params: BuildStartRequest & { pidFile: string; initLogFile: string }): string {
    const projectPath = quoteForShell(params.projectPath)
    const buildDir = quoteForShell(params.buildDir || 'build')
    const pidFile = quoteForShell(params.pidFile)
    const initLogFile = quoteForShell(params.initLogFile)
    const image = params.image
    const extraArgs = params.extraArgs ? ` ${params.extraArgs}` : ''
    const machineExport = params.machine ? `export MACHINE=${quoteForShell(params.machine)}; ` : ''

    const sourceCmd = [
      `if [ -f "oe-init-build-env" ]; then`,
      `  . ./oe-init-build-env ${buildDir} > ${initLogFile};`,
      `elif [ -f "./poky/oe-init-build-env" ]; then`,
      `  . ./poky/oe-init-build-env ${buildDir} > ${initLogFile};`,
      `else`,
      `  echo "__BSP_NO_OE_INIT__";`,
      `  exit 2;`,
      `fi;`
    ].join(' ')

    const buildCmd = [
      `cd ${projectPath} &&`,
      sourceCmd,
      machineExport,
      `( bitbake ${image}${extraArgs} ) &`,
      `echo $! > ${pidFile};`,
      `wait $(cat ${pidFile});`,
      `status=$?;`,
      `rm -f ${pidFile};`,
      `exit $status;`
    ].join(' ')

    return `bash -lc ${quoteForShell(buildCmd)}`
  }

  private emitLog(event: BuildLogEvent): void {
    this.emit('log', event)
  }

  private emitStatus(): void {
    this.emit('status', this.status)
  }
}

export const buildManager = new BuildManager()
