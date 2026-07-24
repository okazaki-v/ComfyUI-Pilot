export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected'

export type MonitorPhase = 'idle' | 'running' | 'done' | 'error'

export type ChimeKind = 'done' | 'error'

export interface AppSettings {
  servers?: string[]
  activeServer?: string
  zoomFactor?: number
  muted?: boolean
  floatEnabled?: boolean
  sidebarOpen?: boolean
  closeAction?: 'minimize' | 'quit'
  notifyEvery?: 'queue' | 'each'
  shortcut?: string
  autoLaunch?: boolean
}

export interface NodeProgress {
  value: number
  max: number
}

export interface MonitorSnapshot {
  phase: MonitorPhase
  queueRemaining: number
  nodeName?: string
  nodeProgress?: NodeProgress
  overall?: number
  startedAt?: number
  errorMessage?: string
}

export interface QueueItemInfo {
  promptId: string
  number: number
  nodeCount: number
}

export interface QueueInfo {
  running: QueueItemInfo[]
  pending: QueueItemInfo[]
}

export interface HistoryImage {
  url: string
  thumb: string
}

export interface HistoryItemInfo {
  promptId: string
  number: number
  ok: boolean
  images: HistoryImage[]
  errorMessage?: string
}

export interface AppState {
  connection: ConnectionState
  snapshot: MonitorSnapshot
}

export interface ShellApi {
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  hideToTray: () => void
  showMain: () => void
  openExternal: (url: string) => void
  getSettings: () => Promise<AppSettings>
  getState: () => Promise<AppState>
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  connect: (url: string) => Promise<AppSettings>
  switchServer: (url: string) => Promise<AppSettings>
  removeServer: (url: string) => Promise<AppSettings>
  setSetupOpen: (open: boolean) => void
  setSidebarOpen: (open: boolean) => void
  floatDragStart: () => void
  floatDragMove: (dx: number, dy: number) => void
  floatDragEnd: () => void
  reloadComfy: () => void
  interrupt: () => void
  clearQueue: () => void
  cancelQueueItem: (promptId: string) => void
  getQueue: () => Promise<QueueInfo>
  getHistory: () => Promise<HistoryItemInfo[]>
  ackDone: () => void
  onStatus: (cb: (state: ConnectionState) => void) => () => void
  onMaximized: (cb: (maximized: boolean) => void) => () => void
  onMonitor: (cb: (snapshot: MonitorSnapshot) => void) => () => void
  onPreview: (cb: (dataUrl: string | null) => void) => () => void
  onChime: (cb: (kind: ChimeKind) => void) => () => void
}

declare global {
  interface Window {
    api: ShellApi
  }
}
