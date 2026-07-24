import { contextBridge, ipcRenderer } from 'electron'

function subscribe<T>(channel: string): (cb: (payload: T) => void) => () => void {
  return (cb) => {
    const handler = (_e: unknown, payload: T): void => cb(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

const api = {
  minimize: (): void => ipcRenderer.send('win:minimize'),
  toggleMaximize: (): void => ipcRenderer.send('win:toggle-maximize'),
  close: (): void => ipcRenderer.send('win:close'),
  hideToTray: (): void => ipcRenderer.send('win:hide-to-tray'),
  showMain: (): void => ipcRenderer.send('app:show-main'),
  openExternal: (url: string): void => ipcRenderer.send('app:open-external', url),

  getSettings: (): Promise<unknown> => ipcRenderer.invoke('settings:get'),
  getState: (): Promise<unknown> => ipcRenderer.invoke('state:get'),
  updateSettings: (patch: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke('settings:update', patch),
  connect: (url: string): Promise<unknown> => ipcRenderer.invoke('server:connect', url),
  switchServer: (url: string): Promise<unknown> => ipcRenderer.invoke('server:switch', url),
  removeServer: (url: string): Promise<unknown> => ipcRenderer.invoke('server:remove', url),
  setSetupOpen: (open: boolean): void => ipcRenderer.send('ui:setup-open', open),
  setSidebarOpen: (open: boolean): void => ipcRenderer.send('ui:sidebar-open', open),
  floatDragStart: (): void => ipcRenderer.send('float:drag-start'),
  floatDragMove: (dx: number, dy: number): void => ipcRenderer.send('float:drag-move', dx, dy),
  floatDragEnd: (): void => ipcRenderer.send('float:drag-end'),

  reloadComfy: (): void => ipcRenderer.send('comfy:reload'),
  interrupt: (): void => ipcRenderer.send('comfy:interrupt'),
  clearQueue: (): void => ipcRenderer.send('comfy:clear-queue'),
  cancelQueueItem: (promptId: string): void => ipcRenderer.send('comfy:cancel', promptId),
  getQueue: (): Promise<unknown> => ipcRenderer.invoke('comfy:queue'),
  getHistory: (): Promise<unknown> => ipcRenderer.invoke('comfy:history'),
  ackDone: (): void => ipcRenderer.send('monitor:ack'),

  onStatus: subscribe<string>('server:status'),
  onMaximized: subscribe<boolean>('win:maximized'),
  onMonitor: subscribe<unknown>('monitor:update'),
  onPreview: subscribe<string | null>('monitor:preview'),
  onChime: subscribe<string>('monitor:chime')
}

contextBridge.exposeInMainWorld('api', api)
