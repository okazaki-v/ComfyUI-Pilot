import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Settings {
  /** @deprecated 旧版单服务器字段，启动时迁移到 servers/activeServer */
  serverUrl?: string
  /** 服务器地址列表 */
  servers?: string[]
  /** 当前活动服务器 */
  activeServer?: string
  windowBounds?: WindowBounds
  isMaximized?: boolean
  zoomFactor?: number
  /** 提醒时机：queue = 仅队列全部完成（默认），each = 每个任务完成 */
  notifyEvery?: 'queue' | 'each'
  /** 全局显示/隐藏快捷键，默认 Control+Alt+C */
  shortcut?: string
  /** 开机自启 */
  autoLaunch?: boolean
  /** 完成/错误提示音开关，默认开 */
  muted?: boolean
  /** 关闭按钮行为，默认 minimize（最小化到托盘） */
  closeAction?: 'minimize' | 'quit'
  /** 收纳托盘时显示迷你悬浮窗，默认开 */
  floatEnabled?: boolean
  /** 悬浮窗位置 */
  floatPos?: { x: number; y: number }
  /** 任务侧边栏展开状态 */
  sidebarOpen?: boolean
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf-8')) as Settings
  } catch {
    return {}
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch }
  try {
    mkdirSync(dirname(settingsFile()), { recursive: true })
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2))
  } catch (err) {
    console.error('[settings] save failed:', err)
  }
  return next
}

/** 旧版单服务器配置 → 服务器列表 */
export function migrateSettings(): Settings {
  const s = loadSettings()
  if (s.serverUrl && (!s.servers || s.servers.length === 0)) {
    return saveSettings({ servers: [s.serverUrl], activeServer: s.serverUrl })
  }
  if (s.servers?.length && (!s.activeServer || !s.servers.includes(s.activeServer))) {
    return saveSettings({ activeServer: s.servers[0] })
  }
  return s
}
