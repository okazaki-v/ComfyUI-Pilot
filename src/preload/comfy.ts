import { ipcRenderer } from 'electron'

/**
 * 注入到 ComfyUI 页面：把其 WebSocket 收到的事件流转发给主进程。
 * ComfyUI 服务端只把执行事件（progress/executing/execution_success…）
 * 和二进制预览帧发给提交任务的那个客户端，主进程自己的监控连接收不到，
 * 因此必须在页面世界拦截前端的 WebSocket 才能监控本工作区提交的任务。
 */
const NativeWebSocket = window.WebSocket

function isComfyEventStream(url: unknown): boolean {
  try {
    return /\/ws(\?|$)/.test(String(url))
  } catch {
    return false
  }
}

function forward(data: unknown): void {
  if (typeof data === 'string') {
    ipcRenderer.send('comfy:ws-event', data)
  } else if (data instanceof ArrayBuffer) {
    ipcRenderer.send('comfy:ws-binary', new Uint8Array(data))
  } else if (data instanceof Blob) {
    void data.arrayBuffer().then((buf) => ipcRenderer.send('comfy:ws-binary', new Uint8Array(buf)))
  }
}

window.WebSocket = new Proxy(NativeWebSocket, {
  construct(target, args) {
    const ws = new target(args[0] as string, args[1] as string | string[] | undefined)
    if (isComfyEventStream(args[0])) {
      ws.addEventListener('message', (ev: MessageEvent) => forward(ev.data))
    }
    return ws
  }
}) as typeof WebSocket
