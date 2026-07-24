import {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  shell,
  screen,
  globalShortcut,
  protocol,
  net,
  Notification
} from 'electron'
import { join } from 'path'
import { ConnectionMonitor, ConnectionState } from './connection'
import { TaskMonitor, MonitorSnapshot } from './taskmonitor'
import { AppTray } from './tray'
import { stateIcon } from './icons'
import { interrupt, clearQueue, deleteQueueItem, fetchQueue, fetchHistory } from './comfyapi'
import { parsePreviewFrame } from './preview'
import { loadSettings, migrateSettings, saveSettings, Settings, WindowBounds } from './settings'

const TITLEBAR_HEIGHT = 40
const SIDEBAR_WIDTH = 300
const MIN_ZOOM = 0.25
const MAX_ZOOM = 3
const FLOAT_SIZE = { width: 344, height: 136 }
const PREVIEW_THROTTLE_MS = 150

interface ServerView {
  view: WebContentsView
  loaded: boolean
  failed: boolean
}

let win: BrowserWindow | null = null
let floatWin: BrowserWindow | null = null
let tray: AppTray | null = null
const serverViews = new Map<string, ServerView>()
let activeUrl: string | null = null
let attachedView: WebContentsView | null = null
let setupOpen = false
let sidebarOpen = false
let isQuitting = false
let lastPreviewAt = 0
let hasPreview = false

function activeView(): WebContentsView | undefined {
  return activeUrl ? serverViews.get(activeUrl)?.view : undefined
}

const monitor = new ConnectionMonitor()
const tasks = new TaskMonitor()

function normalizeServerUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  return url
}

/** 校验保存的窗口位置仍落在某个显示器内，避免拔掉外接屏后窗口丢失 */
function restorableBounds(saved?: WindowBounds): WindowBounds | undefined {
  if (!saved) return undefined
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return (
      saved.x < a.x + a.width - 40 &&
      saved.x + saved.width > a.x + 40 &&
      saved.y >= a.y - 20 &&
      saved.y < a.y + a.height - 40
    )
  })
  return onScreen ? saved : undefined
}

function layoutComfyView(): void {
  if (!win || !attachedView) return
  const { width, height } = win.getContentBounds()
  const top = win.isFullScreen() ? 0 : TITLEBAR_HEIGHT
  const sidebar = sidebarOpen ? SIDEBAR_WIDTH : 0
  attachedView.setBounds({
    x: 0,
    y: top,
    width: Math.max(0, width - sidebar),
    height: Math.max(0, height - top)
  })
}

function updateViewVisibility(): void {
  if (!win) return
  const target = activeUrl ? serverViews.get(activeUrl) : undefined
  const desired = target && target.loaded && !setupOpen ? target.view : null
  if (attachedView === desired) return
  if (attachedView) win.contentView.removeChildView(attachedView)
  attachedView = desired
  if (desired) {
    win.contentView.addChildView(desired)
    layoutComfyView()
  }
}

function ensureServerView(url: string): ServerView {
  const existing = serverViews.get(url)
  if (existing) return existing

  const view = new WebContentsView({
    webPreferences: {
      partition: 'persist:comfyui',
      // ComfyUI 只把执行事件发给提交任务的客户端（即这个内嵌页面），
      // 注入转发器拦截其 WebSocket 才能拿到本工作区任务的进度。
      // 拦截需要与页面同世界，因此关闭 contextIsolation/sandbox（nodeIntegration 仍关闭）
      preload: join(__dirname, '../preload/comfy.js'),
      sandbox: false,
      contextIsolation: false,
      nodeIntegration: false
    }
  })
  const sv: ServerView = { view, loaded: false, failed: false }
  serverViews.set(url, sv)
  const wc = view.webContents

  wc.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target)
    return { action: 'deny' }
  })

  wc.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) sv.failed = true
  })
  wc.on('did-finish-load', () => {
    sv.failed = false
    const zoom = loadSettings().zoomFactor
    if (zoom) wc.setZoomFactor(zoom)
  })

  // Ctrl+滚轮缩放，记忆缩放比例
  wc.on('zoom-changed', (_e, direction) => {
    const next = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, wc.getZoomFactor() + (direction === 'in' ? 0.1 : -0.1))
    )
    wc.setZoomFactor(next)
    saveSettings({ zoomFactor: Number(next.toFixed(2)) })
  })

  // 焦点在 ComfyUI 页面内时，接管外壳级快捷键
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !win) return
    if (input.key === 'F11') {
      e.preventDefault()
      win.setFullScreen(!win.isFullScreen())
    } else if (input.key === 'F5') {
      e.preventDefault()
      wc.reloadIgnoringCache()
    } else if (input.control && input.shift && input.key.toUpperCase() === 'I') {
      e.preventDefault()
      wc.openDevTools({ mode: 'detach' })
    }
  })

  return sv
}

function loadComfy(url: string): void {
  const sv = ensureServerView(url)
  if (!sv.loaded) {
    sv.loaded = true
    sv.failed = false
    void sv.view.webContents.loadURL(url)
  } else if (sv.failed) {
    sv.failed = false
    sv.view.webContents.reload()
  }
  updateViewVisibility()
}

/* ============ 多服务器 ============ */

function switchServer(url: string): void {
  activeUrl = url
  monitor.start(url)
  tasks.setServer(url)
  updateViewVisibility()
}

function addServer(rawUrl: string): Settings {
  const url = normalizeServerUrl(rawUrl)
  const s = loadSettings()
  const servers = s.servers?.includes(url) ? s.servers : [...(s.servers ?? []), url]
  const next = saveSettings({ servers, activeServer: url })
  switchServer(url)
  return next
}

function removeServer(url: string): Settings {
  const s = loadSettings()
  const servers = (s.servers ?? []).filter((u) => u !== url)
  const sv = serverViews.get(url)
  if (sv) {
    if (attachedView === sv.view && win) {
      win.contentView.removeChildView(sv.view)
      attachedView = null
    }
    sv.view.webContents.close()
    serverViews.delete(url)
  }
  let active = s.activeServer
  if (active === url) {
    active = servers[0]
    if (active) {
      switchServer(active)
    } else {
      activeUrl = null
      monitor.stop()
      tasks.stop()
      updateViewVisibility()
    }
  }
  return saveSettings({ servers, activeServer: active })
}

function sendToShell(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

/** 发给外壳 + 悬浮窗 */
function broadcast(channel: string, ...args: unknown[]): void {
  sendToShell(channel, ...args)
  if (floatWin && !floatWin.isDestroyed()) floatWin.webContents.send(channel, ...args)
}

/* ============ 迷你悬浮窗 ============ */

function floatDefaultPos(): { x: number; y: number } {
  const wa = screen.getPrimaryDisplay().workArea
  return { x: wa.x + wa.width - FLOAT_SIZE.width - 16, y: wa.y + wa.height - FLOAT_SIZE.height - 16 }
}

function ensureFloatWindow(): BrowserWindow {
  if (floatWin && !floatWin.isDestroyed()) return floatWin

  const saved = loadSettings().floatPos
  const pos = restorableBounds(saved ? { ...saved, ...FLOAT_SIZE } : undefined) ?? floatDefaultPos()

  floatWin = new BrowserWindow({
    ...FLOAT_SIZE,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      backgroundThrottling: false
    }
  })
  floatWin.setAlwaysOnTop(true, 'screen-saver')

  floatWin.on('closed', () => {
    floatWin = null
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void floatWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#float`)
  } else {
    void floatWin.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'float' })
  }
  return floatWin
}

function showFloat(): void {
  if (loadSettings().floatEnabled === false) return
  const fw = ensureFloatWindow()
  // 不抢焦点地展示
  if (!fw.isVisible()) fw.showInactive()
}

function hideFloat(): void {
  if (floatWin && !floatWin.isDestroyed() && floatWin.isVisible()) floatWin.hide()
}

// 悬浮窗手动拖拽（系统拖拽区会吞掉双击等鼠标事件，改由渲染进程驱动）
let floatDragBase: { x: number; y: number } | null = null

function registerFloatDragIpc(): void {
  ipcMain.on('float:drag-start', () => {
    if (floatWin && !floatWin.isDestroyed()) {
      const [x, y] = floatWin.getPosition()
      floatDragBase = { x, y }
    }
  })
  ipcMain.on('float:drag-move', (_e, dx: number, dy: number) => {
    if (floatWin && !floatWin.isDestroyed() && floatDragBase) {
      floatWin.setPosition(floatDragBase.x + Math.round(dx), floatDragBase.y + Math.round(dy))
    }
  })
  ipcMain.on('float:drag-end', () => {
    floatDragBase = null
    if (floatWin && !floatWin.isDestroyed()) {
      const [x, y] = floatWin.getPosition()
      saveSettings({ floatPos: { x, y } })
    }
  })
}

function showWindow(): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

function toggleWindow(): void {
  if (!win) return
  if (win.isVisible() && !win.isMinimized()) {
    win.hide()
  } else {
    showWindow()
  }
}

/* ============ 监控 → Windows 集成 ============ */

function formatTooltip(s: MonitorSnapshot): string {
  switch (s.phase) {
    case 'running': {
      const pct = s.overall != null ? `${Math.round(s.overall * 100)}% · ` : ''
      const node = s.nodeName
        ? ` · ${s.nodeName}${s.nodeProgress ? ` ${s.nodeProgress.value}/${s.nodeProgress.max}` : ''}`
        : ''
      return `ComfyPilot · 执行中 ${pct}队列剩 ${s.queueRemaining}${node}`
    }
    case 'done':
      return 'ComfyPilot · ✓ 任务全部完成'
    case 'error':
      return `ComfyPilot · ✗ 执行出错${s.errorMessage ? ` · ${s.errorMessage}` : ''}`
    default:
      return 'ComfyPilot · 空闲'
  }
}

function relayPreviewFrame(bytes: Uint8Array): void {
  const now = Date.now()
  if (now - lastPreviewAt < PREVIEW_THROTTLE_MS) return
  const dataUrl = parsePreviewFrame(bytes)
  if (!dataUrl) return
  lastPreviewAt = now
  hasPreview = true
  broadcast('monitor:preview', dataUrl)
}

function applyMonitorSnapshot(s: MonitorSnapshot): void {
  broadcast('monitor:update', s)
  if (s.phase !== 'running' && hasPreview) {
    hasPreview = false
    broadcast('monitor:preview', null)
  }
  tray?.setState(s.phase)
  tray?.setTooltip(formatTooltip(s))

  if (!win || win.isDestroyed()) return
  switch (s.phase) {
    case 'running':
      if (s.overall != null) {
        win.setProgressBar(s.overall)
      } else {
        win.setProgressBar(2, { mode: 'indeterminate' })
      }
      win.setOverlayIcon(stateIcon('running'), '任务执行中')
      break
    case 'error':
      win.setProgressBar(1, { mode: 'error' })
      win.setOverlayIcon(stateIcon('error'), '执行出错')
      break
    case 'done':
      win.setProgressBar(-1)
      win.setOverlayIcon(stateIcon('done', true), '任务全部完成')
      break
    default:
      win.setProgressBar(-1)
      win.setOverlayIcon(null, '')
  }
}

function notifyDone(durationMs?: number): void {
  if (!loadSettings().muted) sendToShell('monitor:chime', 'done')
  win?.flashFrame(true)

  if (Notification.isSupported() && !(win?.isVisible() && win?.isFocused())) {
    const minutes = durationMs ? Math.round(durationMs / 60000) : null
    const n = new Notification({
      title: '✓ 任务全部完成',
      body: minutes && minutes >= 1 ? `队列已清空，共耗时约 ${minutes} 分钟` : '队列已清空',
      silent: true
    })
    n.on('click', showWindow)
    n.show()
  }
}

function notifyError(message?: string): void {
  if (!loadSettings().muted) sendToShell('monitor:chime', 'error')
  win?.flashFrame(true)

  if (Notification.isSupported() && !(win?.isVisible() && win?.isFocused())) {
    const n = new Notification({
      title: '✗ ComfyUI 任务出错',
      body: message ?? '点击查看详情',
      silent: true
    })
    n.on('click', showWindow)
    n.show()
  }
}

/* ============ 窗口 ============ */

function createWindow(): void {
  const settings = loadSettings()
  const bounds = restorableBounds(settings.windowBounds)

  win = new BrowserWindow({
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#111214',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      backgroundThrottling: false
    }
  })

  win.once('ready-to-show', () => {
    if (loadSettings().isMaximized) win?.maximize()
    win?.show()
  })

  win.on('resize', layoutComfyView)
  win.on('enter-full-screen', layoutComfyView)
  win.on('leave-full-screen', layoutComfyView)
  win.on('maximize', () => sendToShell('win:maximized', true))
  win.on('unmaximize', () => sendToShell('win:maximized', false))

  // 用户查看后复位完成/错误状态（FR-3.8）
  win.on('focus', () => {
    win?.flashFrame(false)
    tasks.acknowledge()
  })

  // 主窗收起 → 迷你悬浮窗接棒监控；主窗回来 → 悬浮窗退场
  win.on('hide', showFloat)
  win.on('show', hideFloat)

  win.on('close', (e) => {
    if (!win) return
    const isMaximized = win.isMaximized()
    saveSettings({
      isMaximized,
      ...(isMaximized || win.isFullScreen() ? {} : { windowBounds: win.getBounds() })
    })
    // 默认关闭 = 收纳到托盘继续监控（FR-1.3）
    if (!isQuitting && (loadSettings().closeAction ?? 'minimize') === 'minimize') {
      e.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => {
    win = null
    serverViews.clear()
    attachedView = null
    if (floatWin && !floatWin.isDestroyed()) floatWin.destroy()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  tray = new AppTray({
    onShow: showWindow,
    onInterrupt: () => {
      if (monitor.url) void interrupt(monitor.url)
    },
    onClearQueue: () => {
      if (monitor.url) void clearQueue(monitor.url)
    },
    onToggleMute: (muted) => {
      saveSettings({ muted })
      tray?.rebuildMenu()
    },
    isMuted: () => Boolean(loadSettings().muted),
    onToggleFloat: (enabled) => {
      saveSettings({ floatEnabled: enabled })
      tray?.rebuildMenu()
      if (win && !win.isVisible()) {
        enabled ? showFloat() : hideFloat()
      }
    },
    isFloatEnabled: () => loadSettings().floatEnabled !== false,
    onQuit: () => {
      isQuitting = true
      app.quit()
    }
  })
}

/* ============ IPC ============ */

function registerIpc(): void {
  ipcMain.on('win:minimize', () => win?.minimize())
  ipcMain.on('win:toggle-maximize', () => {
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.on('win:close', () => win?.close())
  ipcMain.on('win:hide-to-tray', () => win?.hide())

  ipcMain.handle('settings:get', () => loadSettings())

  // 渲染进程挂载后主动拉取当前状态——启动时状态迁移可能早于页面订阅，
  // 只靠事件推送会错过（表现为状态灯一直停在初始值）
  ipcMain.handle('state:get', () => ({
    connection: monitor.state,
    snapshot: tasks.snapshot()
  }))

  // 白名单更新设置项，并即时应用副作用
  ipcMain.handle('settings:update', (_e, patch: Record<string, unknown>) => {
    const allowed = ['muted', 'closeAction', 'floatEnabled', 'notifyEvery', 'shortcut', 'autoLaunch'] as const
    const clean: Partial<Settings> = {}
    for (const key of allowed) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (key in patch) (clean as any)[key] = patch[key]
    }
    const next = saveSettings(clean)
    if ('shortcut' in clean) applyShortcut(next.shortcut)
    if ('autoLaunch' in clean) app.setLoginItemSettings({ openAtLogin: Boolean(next.autoLaunch) })
    if ('muted' in clean || 'floatEnabled' in clean) tray?.rebuildMenu()
    if ('floatEnabled' in clean && win && !win.isVisible()) {
      next.floatEnabled !== false ? showFloat() : hideFloat()
    }
    return next
  })

  ipcMain.handle('server:connect', (_e, rawUrl: string) => addServer(rawUrl))
  ipcMain.handle('server:switch', (_e, url: string) => {
    const s = loadSettings()
    if (!s.servers?.includes(url)) return s
    switchServer(url)
    return saveSettings({ activeServer: url })
  })
  ipcMain.handle('server:remove', (_e, url: string) => removeServer(url))

  ipcMain.on('ui:setup-open', (_e, open: boolean) => {
    setupOpen = open
    updateViewVisibility()
  })

  ipcMain.on('ui:sidebar-open', (_e, open: boolean) => {
    sidebarOpen = open
    saveSettings({ sidebarOpen: open })
    layoutComfyView()
  })

  ipcMain.on('app:show-main', showWindow)

  ipcMain.on('app:open-external', (_e, url: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  ipcMain.handle('comfy:queue', () => (monitor.url ? fetchQueue(monitor.url) : { running: [], pending: [] }))
  ipcMain.handle('comfy:history', () => (monitor.url ? fetchHistory(monitor.url) : []))
  ipcMain.on('comfy:cancel', (_e, promptId: unknown) => {
    if (monitor.url && typeof promptId === 'string') void deleteQueueItem(monitor.url, promptId)
  })

  ipcMain.on('comfy:reload', () => activeView()?.webContents.reloadIgnoringCache())
  ipcMain.on('comfy:interrupt', () => {
    if (monitor.url) void interrupt(monitor.url)
  })
  ipcMain.on('comfy:clear-queue', () => {
    if (monitor.url) void clearQueue(monitor.url)
  })
  ipcMain.on('monitor:ack', () => tasks.acknowledge())

  // 内嵌工作区页面转发的 ComfyUI WebSocket 事件流（只采信当前活动服务器的页面）
  ipcMain.on('comfy:ws-event', (e, raw: unknown) => {
    const av = activeView()
    if (av && e.sender === av.webContents && typeof raw === 'string') {
      tasks.ingest(raw)
    }
  })

  // 内嵌工作区页面转发的二进制预览帧
  ipcMain.on('comfy:ws-binary', (e, bytes: unknown) => {
    const av = activeView()
    if (av && e.sender === av.webContents && bytes instanceof Uint8Array) {
      relayPreviewFrame(bytes)
    }
  })
}

/* ============ 事件接线 ============ */

monitor.on('status', (state: ConnectionState) => {
  sendToShell('server:status', state)
  if (state === 'connected' && monitor.url) loadComfy(monitor.url)
})

tasks.on('update', applyMonitorSnapshot)
tasks.on('all-done', ({ durationMs }: { durationMs?: number }) => notifyDone(durationMs))
tasks.on('task-error', ({ message }: { message?: string }) => notifyError(message))
tasks.on('preview-frame', relayPreviewFrame)
// 提醒粒度 = 每任务：队列中间的任务完成时轻提示（队列清空时由 all-done 完整庆祝）
tasks.on('task-done', ({ queueRemaining }: { queueRemaining: number }) => {
  const s = loadSettings()
  if (s.notifyEvery === 'each' && queueRemaining > 0 && !s.muted) {
    sendToShell('monitor:chime', 'done')
  }
})

/** 注册全局显示/隐藏快捷键，非法或冲突时回退默认值 */
function applyShortcut(accel?: string): void {
  globalShortcut.unregisterAll()
  const fallback = 'Control+Alt+C'
  const target = accel?.trim() || fallback
  let ok = false
  try {
    ok = globalShortcut.register(target, toggleWindow)
  } catch {
    ok = false
  }
  if (!ok && target !== fallback) globalShortcut.register(fallback, toggleWindow)
}

/* ============ 应用生命周期 ============ */

// 渲染进程直接加载 http 图片会被跨源/CSP 限制拦截，
// 注册自定义协议由主进程代理 ComfyUI 的 /view 图片请求
protocol.registerSchemesAsPrivileged([
  { scheme: 'comfy-img', privileges: { supportFetchAPI: true, stream: true } }
])

function registerImageProxy(): void {
  protocol.handle('comfy-img', (request) => {
    const qs = request.url.split('?')[1]
    if (!monitor.url || !qs) return new Response(null, { status: 502 })
    return net.fetch(`${monitor.url}/view?${qs}`)
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.whenReady().then(() => {
    app.setAppUserModelId('com.soofany.comfypilot')
    sidebarOpen = Boolean(loadSettings().sidebarOpen)
    registerImageProxy()
    registerIpc()
    registerFloatDragIpc()
    createWindow()
    createTray()

    const settings = migrateSettings()
    applyShortcut(settings.shortcut)
    if (settings.activeServer) switchServer(settings.activeServer)
  })

  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })

  app.on('window-all-closed', () => {
    monitor.stop()
    tasks.stop()
    tray?.destroy()
    tray = null
    app.quit()
  })
}
