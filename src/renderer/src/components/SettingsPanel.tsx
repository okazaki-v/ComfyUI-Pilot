import { useState } from 'react'
import type { AppSettings } from '../../../preload/index.d'

interface Props {
  settings: AppSettings
  onSettingsChange: (next: AppSettings) => void
  onClose: () => void
}

function serverLabel(url: string): string {
  return url.replace(/^https?:\/\//i, '')
}

export default function SettingsPanel(props: Props): React.JSX.Element {
  const { settings } = props
  const [newUrl, setNewUrl] = useState('')
  const [shortcutDraft, setShortcutDraft] = useState(settings.shortcut ?? 'Control+Alt+C')

  const update = (patch: Partial<AppSettings>): void => {
    void window.api.updateSettings(patch).then(props.onSettingsChange)
  }

  const addServer = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!newUrl.trim()) return
    void window.api.connect(newUrl).then((next) => {
      props.onSettingsChange(next)
      setNewUrl('')
    })
  }

  const servers = settings.servers ?? []

  return (
    <div className="setup-backdrop">
      <div className="settings-card">
        <div className="settings-header">
          <h1 className="setup-title">设置</h1>
          <button className="sb-link" onClick={props.onClose}>
            完成
          </button>
        </div>

        <section className="set-section">
          <h2 className="set-heading">服务器</h2>
          <ul className="set-servers">
            {servers.map((url) => (
              <li key={url} className={`set-server${url === settings.activeServer ? ' active' : ''}`}>
                <span className="set-server-url">{serverLabel(url)}</span>
                {url === settings.activeServer ? (
                  <span className="set-server-badge">当前</span>
                ) : (
                  <button
                    className="sb-link"
                    onClick={() => void window.api.switchServer(url).then(props.onSettingsChange)}
                  >
                    切换
                  </button>
                )}
                <button
                  className="sb-link sb-cancel"
                  onClick={() => void window.api.removeServer(url).then(props.onSettingsChange)}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
          <form className="set-add" onSubmit={addServer}>
            <input
              className="setup-input"
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="添加服务器，如 192.168.1.10:8188"
              spellCheck={false}
            />
            <button type="submit" className="btn btn-primary" disabled={!newUrl.trim()}>
              添加
            </button>
          </form>
        </section>

        <section className="set-section">
          <h2 className="set-heading">提醒</h2>
          <label className="set-row">
            <span>提示音</span>
            <input
              type="checkbox"
              checked={!settings.muted}
              onChange={(e) => update({ muted: !e.target.checked })}
            />
          </label>
          <label className="set-row">
            <span>提醒时机</span>
            <select
              className="set-select"
              value={settings.notifyEvery ?? 'queue'}
              onChange={(e) => update({ notifyEvery: e.target.value as 'queue' | 'each' })}
            >
              <option value="queue">仅队列全部完成</option>
              <option value="each">每个任务完成</option>
            </select>
          </label>
        </section>

        <section className="set-section">
          <h2 className="set-heading">行为</h2>
          <label className="set-row">
            <span>关闭按钮</span>
            <select
              className="set-select"
              value={settings.closeAction ?? 'minimize'}
              onChange={(e) => update({ closeAction: e.target.value as 'minimize' | 'quit' })}
            >
              <option value="minimize">收入托盘继续监控</option>
              <option value="quit">退出应用</option>
            </select>
          </label>
          <label className="set-row">
            <span>迷你悬浮窗</span>
            <input
              type="checkbox"
              checked={settings.floatEnabled !== false}
              onChange={(e) => update({ floatEnabled: e.target.checked })}
            />
          </label>
          <label className="set-row">
            <span>开机自启</span>
            <input
              type="checkbox"
              checked={Boolean(settings.autoLaunch)}
              onChange={(e) => update({ autoLaunch: e.target.checked })}
            />
          </label>
          <label className="set-row">
            <span>显示/隐藏快捷键</span>
            <span className="set-shortcut">
              <input
                className="setup-input set-shortcut-input"
                type="text"
                value={shortcutDraft}
                onChange={(e) => setShortcutDraft(e.target.value)}
                onBlur={() => update({ shortcut: shortcutDraft.trim() })}
                placeholder="Control+Alt+C"
                spellCheck={false}
              />
            </span>
          </label>
          <p className="set-hint">
            快捷键使用 Electron 加速键格式（如 <code>Control+Alt+C</code>、<code>Super+Shift+M</code>），
            无效时自动回退默认值
          </p>
        </section>
      </div>
    </div>
  )
}
