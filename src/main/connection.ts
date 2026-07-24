import { EventEmitter } from 'events'
import { net } from 'electron'

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected'

const PROBE_TIMEOUT_MS = 4000
const POLL_INTERVAL_MS = 5000
const MAX_BACKOFF_MS = 15000

/**
 * 周期性探测 ComfyUI 服务（GET /system_stats）并维护连接状态。
 * 失败后指数退避重试，永不放弃 —— 服务恢复后状态自动回到 connected。
 */
export class ConnectionMonitor extends EventEmitter {
  url: string | null = null
  state: ConnectionState = 'idle'
  private timer: NodeJS.Timeout | null = null
  private failCount = 0
  private probeSeq = 0

  start(url: string): void {
    this.stopTimer()
    this.probeSeq++
    this.url = url
    this.failCount = 0
    this.setState('connecting')
    void this.probe()
  }

  stop(): void {
    this.stopTimer()
    this.probeSeq++
    this.url = null
    this.setState('idle')
  }

  private stopTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return
    this.state = state
    this.emit('status', state)
  }

  private schedule(ms: number): void {
    this.stopTimer()
    this.timer = setTimeout(() => void this.probe(), ms)
  }

  private async probe(): Promise<void> {
    if (!this.url) return
    const seq = this.probeSeq
    let ok = false
    try {
      const res = await net.fetch(`${this.url}/system_stats`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      })
      ok = res.ok
    } catch {
      ok = false
    }
    if (seq !== this.probeSeq) return

    if (ok) {
      this.failCount = 0
      this.setState('connected')
      this.schedule(POLL_INTERVAL_MS)
    } else {
      this.failCount++
      this.setState(this.failCount >= 2 ? 'disconnected' : 'connecting')
      this.schedule(Math.min(1000 * 2 ** Math.min(this.failCount, 4), MAX_BACKOFF_MS))
    }
  }
}
