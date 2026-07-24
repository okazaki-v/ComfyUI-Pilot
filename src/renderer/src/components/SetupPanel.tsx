import { useState } from 'react'
import type { ConnectionState } from '../../../preload/index.d'

interface Props {
  initialUrl: string
  status: ConnectionState
  canCancel: boolean
  onConnect: (url: string) => void
  onCancel: () => void
}

export default function SetupPanel(props: Props): React.JSX.Element {
  const [url, setUrl] = useState(props.initialUrl)
  const [submitted, setSubmitted] = useState(false)

  const connecting = submitted && props.status === 'connecting'
  const failed = submitted && props.status === 'disconnected'

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!url.trim()) return
    setSubmitted(true)
    props.onConnect(url)
  }

  return (
    <div className="setup-backdrop">
      <form className="setup-card" onSubmit={submit}>
        <div className="setup-logo" />
        <h1 className="setup-title">连接 ComfyUI 服务器</h1>
        <p className="setup-hint">
          填写 ComfyUI 服务地址，本机默认为 <code>http://127.0.0.1:8188</code>
        </p>

        <input
          className="setup-input"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://127.0.0.1:8188"
          spellCheck={false}
          autoFocus
        />

        {failed && (
          <p className="setup-error">
            无法连接到该地址，请确认 ComfyUI 已启动、地址与端口正确（后台仍在自动重试）
          </p>
        )}

        <div className="setup-actions">
          {props.canCancel && (
            <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
              取消
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={connecting || !url.trim()}>
            {connecting ? '连接中…' : '连接'}
          </button>
        </div>
      </form>
    </div>
  )
}
