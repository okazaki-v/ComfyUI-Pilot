import { net } from 'electron'

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
  /** 服务器 /view 完整 URL（外部浏览器打开用） */
  url: string
  /** comfy-img:// 代理地址（渲染进程 <img> 用，绕开跨源限制） */
  thumb: string
}

export interface HistoryItemInfo {
  promptId: string
  number: number
  ok: boolean
  /** 输出图，最多取前 6 张 */
  images: HistoryImage[]
  errorMessage?: string
}

async function post(url: string, body?: unknown): Promise<void> {
  try {
    await net.fetch(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000)
    })
  } catch (err) {
    console.error(`[comfyapi] POST ${url} failed:`, err)
  }
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** 中断当前正在执行的任务 */
export function interrupt(serverUrl: string): Promise<void> {
  return post(`${serverUrl}/interrupt`)
}

/** 清空等待队列（不影响正在执行的任务） */
export function clearQueue(serverUrl: string): Promise<void> {
  return post(`${serverUrl}/queue`, { clear: true })
}

/** 从等待队列中删除单个任务 */
export function deleteQueueItem(serverUrl: string, promptId: string): Promise<void> {
  return post(`${serverUrl}/queue`, { delete: [promptId] })
}

function toQueueItem(entry: unknown[]): QueueItemInfo {
  const workflow = entry?.[2]
  return {
    promptId: String(entry?.[1] ?? ''),
    number: Number(entry?.[0] ?? 0),
    nodeCount: workflow && typeof workflow === 'object' ? Object.keys(workflow).length : 0
  }
}

export async function fetchQueue(serverUrl: string): Promise<QueueInfo> {
  const q = await getJson<{ queue_running?: unknown[][]; queue_pending?: unknown[][] }>(
    `${serverUrl}/queue`
  )
  return {
    running: (q?.queue_running ?? []).map(toQueueItem),
    pending: (q?.queue_pending ?? []).map(toQueueItem).sort((a, b) => a.number - b.number)
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchHistory(serverUrl: string, maxItems = 20): Promise<HistoryItemInfo[]> {
  const hist = await getJson<Record<string, any>>(`${serverUrl}/history?max_items=${maxItems}`)
  if (!hist) return []

  const items: HistoryItemInfo[] = []
  for (const [promptId, item] of Object.entries(hist)) {
    const images: HistoryImage[] = []
    for (const output of Object.values(item?.outputs ?? {}) as any[]) {
      for (const img of output?.images ?? []) {
        if (!img?.filename || images.length >= 6) continue
        const params = new URLSearchParams({
          filename: String(img.filename),
          subfolder: String(img.subfolder ?? ''),
          type: String(img.type ?? 'output')
        })
        images.push({
          url: `${serverUrl}/view?${params}`,
          thumb: `comfy-img://view?${params}`
        })
      }
    }
    const ok = item?.status?.status_str !== 'error'
    let errorMessage: string | undefined
    if (!ok) {
      const err = item?.status?.messages?.find((m: unknown[]) => m?.[0] === 'execution_error')?.[1]
      if (err) {
        errorMessage = `${err.node_type ? `${err.node_type}: ` : ''}${err.exception_message ?? '未知错误'}`
      }
    }
    items.push({
      promptId,
      number: Number(item?.prompt?.[0] ?? 0),
      ok,
      images,
      errorMessage
    })
  }
  return items.sort((a, b) => b.number - a.number)
}
/* eslint-enable @typescript-eslint/no-explicit-any */
