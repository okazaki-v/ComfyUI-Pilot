import { useEffect, useRef, useState } from 'react'
import type { MonitorSnapshot } from '../../preload/index.d'
import { formatElapsed } from './format'

const PHASE_META = {
  idle: { label: '空闲', className: 'float-idle' },
  running: { label: '执行中', className: 'float-running' },
  done: { label: '全部完成', className: 'float-done' },
  error: { label: '执行出错', className: 'float-error' }
} as const

/** 迷你悬浮窗：主窗收进托盘后的实时监控卡片 */
export default function FloatApp(): React.JSX.Element {
  const [snap, setSnap] = useState<MonitorSnapshot | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  // 手动拖拽（不用系统拖拽区，否则双击等鼠标事件会被吞掉）
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const offMonitor = window.api.onMonitor(setSnap)
    const offPreview = window.api.onPreview(setPreview)
    // 拉取当前状态，补上订阅之前错过的状态迁移
    void window.api.getState().then(({ snapshot }) => setSnap(snapshot))
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      offMonitor()
      offPreview()
      clearInterval(tick)
    }
  }, [])

  const phase = snap?.phase ?? 'idle'
  const meta = PHASE_META[phase]
  const pct = snap?.overall != null ? Math.round(snap.overall * 100) : null
  const running = phase === 'running'

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    drag.current = { x: e.screenX, y: e.screenY }
    e.currentTarget.setPointerCapture(e.pointerId)
    window.api.floatDragStart()
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current) window.api.floatDragMove(e.screenX - drag.current.x, e.screenY - drag.current.y)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    drag.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
    window.api.floatDragEnd()
  }

  return (
    <div
      className={`float-card ${meta.className}`}
      onDoubleClick={() => window.api.showMain()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="float-body">
        <div className="float-header">
          <span className="float-dot" />
          <span className="float-phase">{meta.label}</span>
          {running && snap && snap.queueRemaining > 0 && (
            <span className="float-queue">队列剩 {snap.queueRemaining}</span>
          )}
          <span className="float-spacer" />
          {running && (
            <button
              className="float-btn"
              title="中断当前任务"
              onClick={() => window.api.interrupt()}
            >
              <svg viewBox="0 0 12 12" width="10" height="10">
                <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          )}
          <button className="float-btn" title="打开主窗口" onClick={() => window.api.showMain()}>
            <svg viewBox="0 0 12 12" width="10" height="10">
              <path
                d="M4.5 2h-2.5v7.5h7.5v-2.5M6.5 2H10v3.5M10 2L5.5 6.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="float-progress">
          <div className="task-bar">
            <div
              className={`task-bar-fill${running && pct == null ? ' task-bar-indeterminate' : ''}${
                phase === 'done' ? ' task-bar-done' : ''
              }${phase === 'error' ? ' task-bar-error' : ''}`}
              style={
                phase === 'done' || phase === 'error'
                  ? { width: '100%' }
                  : pct != null
                    ? { width: `${pct}%` }
                    : undefined
              }
            />
          </div>
          {running && pct != null && <span className="float-pct">{pct}%</span>}
        </div>

        <div className="float-detail">
          {phase === 'running' && (
            <>
              {snap?.nodeName ?? '等待节点信息…'}
              {snap?.nodeProgress && ` ${snap.nodeProgress.value}/${snap.nodeProgress.max}`}
              {snap?.startedAt && (
                <span className="float-elapsed">{formatElapsed(now - snap.startedAt)}</span>
              )}
            </>
          )}
          {phase === 'done' && '队列已清空，双击查看结果'}
          {phase === 'error' && (snap?.errorMessage ?? '双击查看详情')}
          {phase === 'idle' && '等待任务…'}
        </div>
      </div>

      {preview && (
        <div className="float-preview">
          <img src={preview} alt="实时预览" />
        </div>
      )}
    </div>
  )
}
