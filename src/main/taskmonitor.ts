import { EventEmitter } from 'events'
import { net } from 'electron'
import { randomUUID } from 'crypto'
import WebSocket from 'ws'

export type MonitorPhase = 'idle' | 'running' | 'done' | 'error'

export interface NodeProgress {
  value: number
  max: number
}

export interface MonitorSnapshot {
  phase: MonitorPhase
  queueRemaining: number
  nodeName?: string
  nodeProgress?: NodeProgress
  /** 0–1 的整体进度估算；无法估算时为 undefined（表现为不确定进度） */
  overall?: number
  startedAt?: number
  errorMessage?: string
}

type PromptWorkflow = Record<string, { class_type?: string; _meta?: { title?: string } }>

interface QueueResponse {
  queue_running?: unknown[][]
  queue_pending?: unknown[][]
}

const WS_RECONNECT_MS = 5000
const DONE_DEBOUNCE_MS = 400
const QUEUE_POLL_MS = 2500

/**
 * 监控 ComfyUI 任务执行状态。事件来源有三路，取长补短：
 *  1. 自建 /ws 连接 —— 收广播的 status（队列数）；API 无 client_id 提交的任务事件也在这
 *  2. ingest() —— 内嵌工作区页面 WebSocket 的转发（ComfyUI 只把执行事件发给提交任务的
 *     客户端，本工作区任务的进度全靠这路）
 *  3. /queue 轮询兜底 —— 其他浏览器提交的任务收不到执行事件，靠轮询识别
 *     执行中/完成/出错，保证状态永不卡死
 *
 * 对外事件：update（快照变化）、all-done（队列清空，绿光时刻）、task-error
 */
export class TaskMonitor extends EventEmitter {
  private url: string | null = null
  private ws: WebSocket | null = null
  private wsGen = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private doneTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private settling = false
  private readonly clientId = randomUUID()

  private phase: MonitorPhase = 'idle'
  private queueRemaining = 0
  private currentPromptId: string | null = null
  private nodeName?: string
  private nodeProgress?: NodeProgress
  private startedAt?: number
  private errorMessage?: string

  /** 当前 prompt 的节点 id → 显示名（title 或 class_type），用于估算整体进度 */
  private nodeNames = new Map<string, string>()
  private totalNodes = 0
  private seenNodes = new Set<string>()

  setServer(url: string): void {
    if (this.url === url && this.ws) return
    this.url = url
    this.reconnect()
  }

  stop(): void {
    this.url = null
    this.clearTimers()
    this.closeWs()
  }

  /** 注入来自内嵌工作区页面的 WebSocket 文本帧 */
  ingest(raw: string): void {
    try {
      this.handleMessage(JSON.parse(raw))
    } catch {
      /* 忽略无法解析的消息 */
    }
  }

  acknowledge(): void {
    if (this.phase === 'done' || this.phase === 'error') {
      this.phase = 'idle'
      this.errorMessage = undefined
      this.emitUpdate()
    }
  }

  snapshot(): MonitorSnapshot {
    let overall: number | undefined
    if (this.phase === 'running' && this.totalNodes > 0 && this.seenNodes.size > 0) {
      const frac = this.nodeProgress
        ? this.nodeProgress.value / Math.max(1, this.nodeProgress.max)
        : 0
      const completed = Math.max(0, this.seenNodes.size - 1)
      overall = Math.min(0.99, (completed + frac) / this.totalNodes)
    }
    return {
      phase: this.phase,
      queueRemaining: this.queueRemaining,
      nodeName: this.nodeName,
      nodeProgress: this.nodeProgress,
      overall,
      startedAt: this.startedAt,
      errorMessage: this.errorMessage
    }
  }

  /* ============ WebSocket ============ */

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.doneTimer) clearTimeout(this.doneTimer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.reconnectTimer = null
    this.doneTimer = null
    this.pollTimer = null
  }

  private closeWs(): void {
    this.wsGen++
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* ignore */
      }
      this.ws = null
    }
  }

  private reconnect(): void {
    this.closeWs()
    if (!this.url) return

    const gen = this.wsGen
    const wsUrl = `${this.url.replace(/^http/i, 'ws')}/ws?clientId=${this.clientId}`
    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl)
    } catch (err) {
      console.error('[taskmonitor] ws create failed:', err)
      this.scheduleReconnect(gen)
      return
    }
    this.ws = ws

    ws.on('open', () => console.log(`[taskmonitor] ws connected: ${wsUrl}`))
    ws.on('message', (data, isBinary) => {
      if (gen !== this.wsGen) return
      if (isBinary) {
        // API 无 client_id 提交的任务，其预览帧走广播到达这里
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        this.emit('preview-frame', new Uint8Array(buf))
        return
      }
      try {
        this.handleMessage(JSON.parse(data.toString()))
      } catch {
        /* 忽略无法解析的消息 */
      }
    })
    ws.on('close', () => {
      if (gen !== this.wsGen) return
      console.log('[taskmonitor] ws closed, reconnecting…')
      this.ws = null
      this.scheduleReconnect(gen)
    })
    ws.on('error', (err) => {
      // close 会随后触发，由它负责重连
      if (gen === this.wsGen) console.error('[taskmonitor] ws error:', err.message)
    })
  }

  private scheduleReconnect(gen: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      if (gen === this.wsGen && this.url) this.reconnect()
    }, WS_RECONNECT_MS)
  }

  /* ============ 事件处理 ============ */

  /* eslint-disable @typescript-eslint/no-explicit-any */
  private handleMessage(msg: any): void {
    const data = msg?.data ?? {}
    switch (msg?.type) {
      case 'status': {
        const remaining = data?.status?.exec_info?.queue_remaining
        if (typeof remaining === 'number') {
          this.queueRemaining = remaining
          // 挂接时任务已在执行（应用启动前提交的队列）：立即进入执行中，
          // 节点/进度信息由后续事件或 /queue 轮询补齐
          if (remaining > 0 && this.phase !== 'running') {
            this.phase = 'running'
            this.startedAt ??= Date.now()
          }
          this.emitUpdate()
        }
        break
      }
      case 'execution_start':
        this.beginPrompt(String(data.prompt_id ?? ''))
        break
      case 'executing':
        if (data.node === null) {
          // 旧版协议：node=null 表示当前 prompt 执行结束
          this.finishPrompt('success')
        } else {
          this.onExecutingNode(String(data.display_node ?? data.node))
        }
        break
      case 'execution_success':
        this.finishPrompt('success')
        break
      case 'progress': {
        const value = Number(data.value)
        const max = Number(data.max)
        if (Number.isFinite(value) && Number.isFinite(max)) {
          this.nodeProgress = { value, max }
          if (data.node != null) this.onExecutingNode(String(data.node), false)
          this.emitUpdate()
        }
        break
      }
      case 'execution_cached': {
        const nodes: unknown = data.nodes
        if (Array.isArray(nodes)) for (const n of nodes) this.seenNodes.add(String(n))
        this.emitUpdate()
        break
      }
      case 'execution_error': {
        const nodeType = data.node_type ? `${data.node_type}: ` : ''
        this.errorMessage = `${nodeType}${data.exception_message ?? '未知错误'}`
        this.finishPrompt('error')
        break
      }
      case 'execution_interrupted':
        this.finishPrompt('interrupted')
        break
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  private beginPrompt(promptId: string): void {
    if (this.doneTimer) clearTimeout(this.doneTimer)
    this.doneTimer = null

    if (this.phase !== 'running') this.startedAt = Date.now()
    this.phase = 'running'
    this.currentPromptId = promptId
    this.nodeName = undefined
    this.nodeProgress = undefined
    this.seenNodes.clear()
    this.nodeNames.clear()
    this.totalNodes = 0
    this.emitUpdate()
    void this.fetchPromptMeta(promptId)
  }

  private onExecutingNode(nodeId: string, resetProgress = true): void {
    if (this.phase !== 'running') {
      this.phase = 'running'
      this.startedAt = this.startedAt ?? Date.now()
    }
    if (!this.seenNodes.has(nodeId) && resetProgress) this.nodeProgress = undefined
    this.seenNodes.add(nodeId)
    this.nodeName = this.nodeNames.get(nodeId) ?? `节点 ${nodeId}`
    this.emitUpdate()
  }

  private finishPrompt(reason: 'success' | 'error' | 'interrupted'): void {
    const finishedId = this.currentPromptId
    this.currentPromptId = null
    this.nodeName = undefined
    this.nodeProgress = undefined

    if (reason === 'error') {
      this.phase = 'error'
      this.emitUpdate()
      this.emit('task-error', { promptId: finishedId, message: this.errorMessage })
      return
    }

    if (reason === 'success') {
      this.emit('task-done', { promptId: finishedId, queueRemaining: this.queueRemaining })
    }

    // status/execution_start 事件可能晚于结束事件到达，
    // 防抖后再判定“队列是否全部完成”，避免乱序导致误报
    if (this.doneTimer) clearTimeout(this.doneTimer)
    this.doneTimer = setTimeout(() => {
      this.doneTimer = null
      if (this.phase !== 'running' || this.currentPromptId) return
      if (this.queueRemaining > 0) return // 下一个任务即将开始
      if (reason === 'success') {
        this.settle('done')
      } else {
        this.phase = 'idle'
        this.emitUpdate()
      }
    }, DONE_DEBOUNCE_MS)
  }

  /** 终态迁移（running → done/error），事件路径与轮询路径共用，防止重复触发 */
  private settle(kind: 'done' | 'error', errorMessage?: string): void {
    if (this.phase !== 'running') return
    this.currentPromptId = null
    this.nodeName = undefined
    this.nodeProgress = undefined
    if (kind === 'error') {
      this.phase = 'error'
      this.errorMessage = errorMessage ?? this.errorMessage ?? '执行出错'
      this.emitUpdate()
      this.emit('task-error', { message: this.errorMessage })
    } else {
      this.phase = 'done'
      this.emitUpdate()
      this.emit('all-done', {
        durationMs: this.startedAt ? Date.now() - this.startedAt : undefined
      })
    }
  }

  /* ============ /queue 轮询兜底 ============ */

  private updatePolling(): void {
    const shouldPoll = this.phase === 'running' && this.url !== null
    if (shouldPoll && !this.pollTimer) {
      this.pollTimer = setInterval(() => void this.pollQueue(), QUEUE_POLL_MS)
    } else if (!shouldPoll && this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async pollQueue(): Promise<void> {
    if (!this.url || this.phase !== 'running' || this.settling) return
    let q: QueueResponse
    try {
      const res = await net.fetch(`${this.url}/queue`, { signal: AbortSignal.timeout(4000) })
      if (!res.ok) return
      q = (await res.json()) as QueueResponse
    } catch {
      return // 网络抖动，下轮再试
    }
    if (this.phase !== 'running' || this.settling) return

    const running = q.queue_running ?? []
    const pending = q.queue_pending ?? []
    this.queueRemaining = running.length + pending.length

    if (running.length > 0) {
      const entry = running[0]
      const pid = String(entry?.[1] ?? '')
      if (pid && pid !== this.currentPromptId) {
        // 其他客户端提交的任务：收不到执行事件，从队列里认领它
        this.currentPromptId = pid
        this.adoptPrompt(entry?.[2] as PromptWorkflow | undefined)
      }
      this.emitUpdate()
    } else if (pending.length === 0) {
      // 服务器已空闲但事件路径没收到结束消息 → 从历史记录判定成败
      await this.settleFromHistory()
    } else {
      this.emitUpdate()
    }
  }

  private async settleFromHistory(): Promise<void> {
    if (!this.url) return
    this.settling = true
    let kind: 'done' | 'error' = 'done'
    let errorMessage: string | undefined
    try {
      const pid = this.currentPromptId
      const endpoint = pid ? `/history/${pid}` : '/history?max_items=8'
      const res = await net.fetch(`${this.url}${endpoint}`, { signal: AbortSignal.timeout(4000) })
      if (res.ok) {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const hist = (await res.json()) as Record<string, any>
        const items = Object.values(hist)
        // 未知 prompt 时取队列序号最大（最新）的一条
        const item = pid
          ? hist[pid]
          : items.sort((a, b) => Number(b?.prompt?.[0] ?? 0) - Number(a?.prompt?.[0] ?? 0))[0]
        if (item?.status?.status_str === 'error') {
          kind = 'error'
          const err = item.status.messages?.find((m: unknown[]) => m?.[0] === 'execution_error')?.[1]
          if (err) {
            errorMessage = `${err.node_type ? `${err.node_type}: ` : ''}${err.exception_message ?? '未知错误'}`
          }
        }
        /* eslint-enable @typescript-eslint/no-explicit-any */
      }
    } catch {
      /* history 拿不到就按成功处理 */
    }
    this.settling = false
    this.settle(kind, errorMessage)
  }

  private adoptPrompt(workflow?: PromptWorkflow): void {
    this.seenNodes.clear()
    this.nodeNames.clear()
    this.totalNodes = 0
    if (!workflow || typeof workflow !== 'object') return
    for (const [id, node] of Object.entries(workflow)) {
      this.nodeNames.set(id, node?._meta?.title ?? node?.class_type ?? id)
    }
    this.totalNodes = this.nodeNames.size
  }

  /** 从 /queue 拉取当前 prompt 的工作流，用于节点名映射与总节点数 */
  private async fetchPromptMeta(promptId: string): Promise<void> {
    if (!this.url) return
    try {
      const res = await net.fetch(`${this.url}/queue`, { signal: AbortSignal.timeout(4000) })
      if (!res.ok) return
      const q = (await res.json()) as QueueResponse
      const entries = [...(q.queue_running ?? []), ...(q.queue_pending ?? [])]
      const entry = entries.find((e) => String(e?.[1]) === promptId)
      if (!entry || promptId !== this.currentPromptId) return
      const seen = new Set(this.seenNodes) // 事件路径已统计的节点在 adopt 后保留
      this.adoptPrompt(entry[2] as PromptWorkflow | undefined)
      for (const n of seen) this.seenNodes.add(n)
      if (this.nodeName?.startsWith('节点 ')) {
        const id = this.nodeName.slice(3).trim()
        this.nodeName = this.nodeNames.get(id) ?? this.nodeName
      }
      this.emitUpdate()
    } catch {
      /* 拉取失败则退化为不确定进度 */
    }
  }

  private emitUpdate(): void {
    this.updatePolling()
    this.emit('update', this.snapshot())
  }
}
