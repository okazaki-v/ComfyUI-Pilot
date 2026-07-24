import type { ConnectionState, MonitorSnapshot } from '../../../preload/index.d'

const STATUS_META: Record<ConnectionState, { label: string; className: string }> = {
  idle: { label: '未配置服务器', className: 'status-idle' },
  connecting: { label: '连接中…', className: 'status-connecting' },
  connected: { label: '已连接', className: 'status-connected' },
  disconnected: { label: '已断开 · 自动重连中', className: 'status-disconnected' }
}

interface Props {
  status: ConnectionState
  servers: string[]
  activeServer: string
  monitor: MonitorSnapshot | null
  maximized: boolean
  sidebarOpen: boolean
  onReload: () => void
  onOpenSettings: () => void
  onSwitchServer: (url: string) => void
  onToggleSidebar: () => void
  onAck: () => void
  onMonitorMode: () => void
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

function serverLabel(url: string): string {
  return url.replace(/^https?:\/\//i, '')
}

function TaskChip({ snap, onAck }: { snap: MonitorSnapshot; onAck: () => void }): React.JSX.Element | null {
  if (snap.phase === 'running') {
    const pct = snap.overall != null ? Math.round(snap.overall * 100) : null
    const detail = [
      snap.nodeName &&
        `${snap.nodeName}${snap.nodeProgress ? ` ${snap.nodeProgress.value}/${snap.nodeProgress.max}` : ''}`,
      snap.queueRemaining > 0 && `队列剩 ${snap.queueRemaining}`
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <div className="task-chip task-running" title={detail || '任务执行中'}>
        <div className="task-bar">
          <div
            className={`task-bar-fill${pct == null ? ' task-bar-indeterminate' : ''}`}
            style={pct != null ? { width: `${pct}%` } : undefined}
          />
        </div>
        <span className="task-text">
          {pct != null ? `${pct}%` : '执行中'}
          {snap.queueRemaining > 0 && ` · 剩${snap.queueRemaining}`}
        </span>
      </div>
    )
  }
  if (snap.phase === 'done') {
    return (
      <button className="task-chip task-done" title="点击确认" onClick={onAck}>
        ✓ 任务全部完成
      </button>
    )
  }
  if (snap.phase === 'error') {
    return (
      <button className="task-chip task-error" title={snap.errorMessage ?? '执行出错'} onClick={onAck}>
        ✗ 执行出错
      </button>
    )
  }
  return null
}

export default function TitleBar(props: Props): React.JSX.Element {
  const meta = STATUS_META[props.status]

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <span className="app-logo" />
        <span className="app-name">ComfyPilot</span>
        {props.servers.length <= 1 ? (
          <button
            className={`status-pill ${meta.className}`}
            title={props.activeServer ? `${props.activeServer}\n点击打开设置` : '点击配置服务器'}
            onClick={props.onOpenSettings}
          >
            <span className="status-dot" />
            <span className="status-label">{meta.label}</span>
            {props.activeServer && <span className="status-url">{props.activeServer}</span>}
          </button>
        ) : (
          <div className="server-tabs">
            {props.servers.map((url) => {
              const active = url === props.activeServer
              return (
                <button
                  key={url}
                  className={`server-tab${active ? ` server-tab-active ${meta.className}` : ''}`}
                  title={active ? `${url} · ${meta.label}` : `切换到 ${url}`}
                  onClick={() => (active ? props.onOpenSettings() : props.onSwitchServer(url))}
                >
                  {active && <span className="status-dot" />}
                  {serverLabel(url)}
                </button>
              )
            })}
          </div>
        )}
        {props.monitor && <TaskChip snap={props.monitor} onAck={props.onAck} />}
      </div>

      <div className="titlebar-actions">
        <button className="tb-btn" title="刷新工作区 (F5)" onClick={props.onReload}>
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path
              d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          className={`tb-btn${props.sidebarOpen ? ' tb-btn-active' : ''}`}
          title="任务侧边栏"
          onClick={props.onToggleSidebar}
        >
          <svg viewBox="0 0 16 16" width="14" height="14">
            <rect
              x="2"
              y="3"
              width="12"
              height="10"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path d="M10 3v10" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
        <button className="tb-btn" title="设置" onClick={props.onOpenSettings}>
          <svg viewBox="0 0 16 16" width="14" height="14">
            <circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path
              d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6L11 5M5 11l-1.4 1.4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          className="tb-btn"
          title="收入托盘监控 (Ctrl+Alt+C)&#10;任务进度显示在托盘图标，完成时亮绿光并提示"
          onClick={props.onMonitorMode}
        >
          <svg viewBox="0 0 16 16" width="14" height="14">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="8" cy="8" r="2" fill="currentColor" />
          </svg>
        </button>

        <span className="tb-divider" />

        <button className="tb-btn" title="最小化" onClick={props.onMinimize}>
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path d="M3 8.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="tb-btn"
          title={props.maximized ? '还原' : '最大化'}
          onClick={props.onToggleMaximize}
        >
          {props.maximized ? (
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path
                d="M5.5 5.5V3.5h7v7h-2M3.5 5.5h7v7h-7z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="14" height="14">
              <rect
                x="3.5"
                y="3.5"
                width="9"
                height="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
            </svg>
          )}
        </button>
        <button className="tb-btn tb-btn-close" title="关闭（收入托盘继续监控）" onClick={props.onClose}>
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  )
}
