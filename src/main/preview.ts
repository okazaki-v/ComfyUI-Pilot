/**
 * 解析 ComfyUI WebSocket 二进制预览帧：
 *   [0..4)  事件类型（大端，1 = PREVIEW_IMAGE）
 *   [4..8)  图片格式（1 = JPEG，2 = PNG）
 *   [8..]   图片数据
 * 返回可直接用于 <img src> 的 data URL；非预览帧返回 null。
 */
export function parsePreviewFrame(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 9) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0) !== 1) return null
  const mime = view.getUint32(4) === 2 ? 'image/png' : 'image/jpeg'
  const b64 = Buffer.from(bytes.buffer, bytes.byteOffset + 8, bytes.byteLength - 8).toString(
    'base64'
  )
  return `data:${mime};base64,${b64}`
}
