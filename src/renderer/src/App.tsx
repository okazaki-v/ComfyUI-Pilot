import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, ConnectionState, MonitorSnapshot } from '../../preload/index.d'
import TitleBar from './components/TitleBar'
import SetupPanel from './components/SetupPanel'
import SettingsPanel from './components/SettingsPanel'
import Sidebar from './components/Sidebar'
import { playChime } from './sounds'

type Overlay = 'none' | 'setup' | 'settings'

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [status, setStatus] = useState<ConnectionState>('idle')
  const [monitorSnap, setMonitorSnap] = useState<MonitorSnapshot | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [overlay, setOverlayState] = useState<Overlay>('none')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const awaitingConnect = useRef(false)

  const setOverlay = useCallback((next: Overlay) => {
    setOverlayState(next)
    window.api.setSetupOpen(next !== 'none')
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      window.api.setSidebarOpen(!prev)
      return !prev
    })
  }, [])

  useEffect(() => {
    const offStatus = window.api.onStatus(setStatus)
    const offMax = window.api.onMaximized(setMaximized)
    const offMonitor = window.api.onMonitor(setMonitorSnap)
    const offPreview = window.api.onPreview(setPreview)
    const offChime = window.api.onChime(playChime)
    void window.api.getSettings().then((s) => {
      setSettings(s)
      setSidebarOpen(Boolean(s.sidebarOpen))
      if (!s.servers?.length) setOverlay('setup')
    })
    // 拉取当前状态，补上订阅之前错过的状态迁移
    void window.api.getState().then(({ connection, snapshot }) => {
      setStatus(connection)
      setMonitorSnap(snapshot)
    })
    return () => {
      offStatus()
      offMax()
      offMonitor()
      offPreview()
      offChime()
    }
  }, [setOverlay])

  useEffect(() => {
    if (status === 'connected' && awaitingConnect.current) {
      awaitingConnect.current = false
      setOverlay('none')
    }
  }, [status, setOverlay])

  const handleConnect = useCallback(async (url: string) => {
    awaitingConnect.current = true
    const next = await window.api.connect(url)
    setSettings(next)
  }, [])

  const handleSwitch = useCallback(async (url: string) => {
    const next = await window.api.switchServer(url)
    setSettings(next)
  }, [])

  if (!settings) return <div className="app" />

  const activeServer = settings.activeServer ?? ''

  return (
    <div className="app">
      <TitleBar
        status={status}
        servers={settings.servers ?? []}
        activeServer={activeServer}
        monitor={monitorSnap}
        maximized={maximized}
        sidebarOpen={sidebarOpen}
        onReload={() => window.api.reloadComfy()}
        onOpenSettings={() => setOverlay('settings')}
        onSwitchServer={(url) => void handleSwitch(url)}
        onToggleSidebar={toggleSidebar}
        onAck={() => window.api.ackDone()}
        onMonitorMode={() => window.api.hideToTray()}
        onMinimize={() => window.api.minimize()}
        onToggleMaximize={() => window.api.toggleMaximize()}
        onClose={() => window.api.close()}
      />
      <div className="main-row">
        <main className="content">
          {overlay === 'setup' && (
            <SetupPanel
              initialUrl={activeServer || 'http://127.0.0.1:8188'}
              status={status}
              canCancel={Boolean(settings.servers?.length)}
              onConnect={handleConnect}
              onCancel={() => setOverlay('none')}
            />
          )}
          {overlay === 'settings' && (
            <SettingsPanel
              settings={settings}
              onSettingsChange={setSettings}
              onClose={() => setOverlay('none')}
            />
          )}
          {overlay === 'none' && (
            <div className="placeholder">
              {status === 'connected' ? (
                <span className="placeholder-text">正在加载 ComfyUI 工作区…</span>
              ) : status === 'idle' ? (
                <span className="placeholder-text">尚未配置服务器</span>
              ) : (
                <>
                  <div className="spinner" />
                  <span className="placeholder-text">
                    正在连接 {activeServer}
                    {status === 'disconnected' && '（服务不可达，自动重试中）'}
                  </span>
                </>
              )}
            </div>
          )}
        </main>
        {sidebarOpen && <Sidebar snap={monitorSnap} preview={preview} />}
      </div>
    </div>
  )
}
