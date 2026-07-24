import { Menu, Tray } from 'electron'
import { IconState, stateIcon } from './icons'

export interface TrayHandlers {
  onShow: () => void
  onInterrupt: () => void
  onClearQueue: () => void
  onToggleMute: (muted: boolean) => void
  onToggleFloat: (enabled: boolean) => void
  onQuit: () => void
  isMuted: () => boolean
  isFloatEnabled: () => boolean
}

export class AppTray {
  private tray: Tray
  private state: IconState = 'idle'
  private pulseTimer: NodeJS.Timeout | null = null
  private pulseOn = false

  constructor(private handlers: TrayHandlers) {
    this.tray = new Tray(stateIcon('idle'))
    this.tray.setToolTip('ComfyPilot · 空闲')
    this.tray.on('click', handlers.onShow)
    this.rebuildMenu()
  }

  setState(state: IconState): void {
    if (this.state === state) return
    this.state = state
    if (state === 'done') {
      this.startPulse()
    } else {
      this.stopPulse()
      this.tray.setImage(stateIcon(state, state === 'error'))
    }
  }

  setTooltip(text: string): void {
    this.tray.setToolTip(text)
  }

  rebuildMenu(): void {
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: this.handlers.onShow },
        { type: 'separator' },
        { label: '中断当前任务', click: this.handlers.onInterrupt },
        { label: '清空等待队列', click: this.handlers.onClearQueue },
        { type: 'separator' },
        {
          label: '提示音',
          type: 'checkbox',
          checked: !this.handlers.isMuted(),
          click: (item) => this.handlers.onToggleMute(!item.checked)
        },
        {
          label: '迷你悬浮窗',
          type: 'checkbox',
          checked: this.handlers.isFloatEnabled(),
          click: (item) => this.handlers.onToggleFloat(item.checked)
        },
        { type: 'separator' },
        { label: '退出 ComfyPilot', click: this.handlers.onQuit }
      ])
    )
  }

  destroy(): void {
    this.stopPulse()
    this.tray.destroy()
  }

  /** 完成态绿色呼吸辉光，直到状态被复位 */
  private startPulse(): void {
    this.stopPulse()
    this.pulseOn = true
    this.tray.setImage(stateIcon('done', true))
    this.pulseTimer = setInterval(() => {
      this.pulseOn = !this.pulseOn
      this.tray.setImage(stateIcon('done', this.pulseOn))
    }, 700)
  }

  private stopPulse(): void {
    if (this.pulseTimer) clearInterval(this.pulseTimer)
    this.pulseTimer = null
  }
}
