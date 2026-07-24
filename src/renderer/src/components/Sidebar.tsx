import { useCallback, useEffect, useState } from 'react'
import type { HistoryItemInfo, MonitorSnapshot, QueueInfo } from '../../../preload/index.d'
import { formatElapsed } from '../format'

interface Props {
  snap: MonitorSnapshot | null
  preview: string | null
}

export default function Sidebar({ snap, preview }: Props): React.JSX.Element {
  const [queue, setQueue] = useState<QueueInfo>({ running: [], pending: [] })
  const [history, setHistory] = useState<HistoryItemInfo[]>([])
  const [now, setNow] = useState(Date.now())

  const refresh = useCallback(() => {
    void window.api.getQueue().then(setQueue)
    void window.api.getHistory().then(setHistory)
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(() => {
      refresh()
      setNow(Date.now())
    }, 4000)
    return () => clearInterval(timer)
  }, [refresh])

  // 任务开始/结束/队列变化时立即刷新
  const phase = snap?.phase
  const remaining = snap?.queueRemaining
  useEffect(() => {
    const t = setTimeout(refresh, 500) // 等服务端历史落库
    return () => clearTimeout(t)
  }, [phase, remaining, refresh])

  useEffect(() => {
    if (phase !== 'running') return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [phase])

  const running = phase === 'running'
  const pct = snap?.overall != null ? Math.round(snap.overall * 100) : null
  const lastError = snap?.errorMessage ?? history.find((h) => !h.ok)?.errorMessage

  return (
    <aside className="sidebar">
      {/* 当前任务 */}
      <section className="sb-section">
        <div className="sb-heading">
          <span>当前任务</span>
          {running && (
            <button className="sb-link" onClick={() => window.api.interrupt()}>
              中断
            </button>
          )}
        </div>
        <div className={`sb-current ${running ? 'sb-current-running' : ''}`}>
          {running ? (
            <>
              <div className="sb-current-row">
                <div className="task-bar">
                  <div
                    className={`task-bar-fill${pct == null ? ' task-bar-indeterminate' : ''}`}
                    style={pct != null ? { width: `${pct}%` } : undefined}
                  />
                </div>
                {pct != null && <span className="sb-pct">{pct}%</span>}
              </div>
              <div className="sb-current-detail">
                {snap?.nodeName ?? '等待节点信息…'}
                {snap?.nodeProgress && ` ${snap.nodeProgress.value}/${snap.nodeProgress.max}`}
                {snap?.startedAt && (
                  <span className="sb-elapsed">{formatElapsed(now - snap.startedAt)}</span>
                )}
              </div>
              {preview && (
                <div className="sb-preview">
                  <img src={preview} alt="实时预览" />
                </div>
              )}
            </>
          ) : (
            <div className="sb-empty">
              {phase === 'done' ? '✓ 队列已全部完成' : phase === 'error' ? '✗ 上个任务出错' : '空闲中，等待任务'}
            </div>
          )}
        </div>
      </section>

      {/* 队列 */}
      <section className="sb-section">
        <div className="sb-heading">
          <span>等待队列 {queue.pending.length > 0 && `(${queue.pending.length})`}</span>
          {queue.pending.length > 0 && (
            <button className="sb-link" onClick={() => window.api.clearQueue()}>
              清空
            </button>
          )}
        </div>
        {queue.pending.length === 0 ? (
          <div className="sb-empty">没有等待中的任务</div>
        ) : (
          <ul className="sb-queue">
            {queue.pending.map((item) => (
              <li key={item.promptId} className="sb-queue-item">
                <span className="sb-queue-num">#{item.number}</span>
                <span className="sb-queue-info">{item.nodeCount} 个节点</span>
                <button
                  className="sb-link sb-cancel"
                  title="取消该任务"
                  onClick={() => window.api.cancelQueueItem(item.promptId)}
                >
                  取消
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 报错 */}
      {lastError && (
        <section className="sb-section">
          <div className="sb-heading">
            <span>最近报错</span>
            <button className="sb-link" onClick={() => void navigator.clipboard.writeText(lastError)}>
              复制
            </button>
          </div>
          <div className="sb-error">{lastError}</div>
        </section>
      )}

      {/* 历史 */}
      <section className="sb-section sb-section-grow">
        <div className="sb-heading">
          <span>历史记录</span>
        </div>
        {history.length === 0 ? (
          <div className="sb-empty">还没有已完成的任务</div>
        ) : (
          <div className="sb-history">
            {history.map((item) => (
              <div key={item.promptId} className="sb-history-item">
                <div className="sb-history-meta">
                  <span className={`sb-status-dot ${item.ok ? 'ok' : 'err'}`} />
                  <span className="sb-history-num">#{item.number}</span>
                  <span className="sb-history-count">
                    {item.ok ? `${item.images.length} 张输出` : '执行出错'}
                  </span>
                </div>
                {item.images.length > 0 && (
                  <div className="sb-thumbs">
                    {item.images.slice(0, 4).map((img) => (
                      <button
                        key={img.thumb}
                        className="sb-thumb"
                        title="在浏览器中查看大图"
                        onClick={() => window.api.openExternal(img.url)}
                      >
                        <img src={img.thumb} alt="输出图" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  )
}
