import { nativeImage, NativeImage } from 'electron'

export type IconState = 'idle' | 'running' | 'done' | 'error'

const COLORS: Record<IconState, [number, number, number]> = {
  idle: [154, 160, 168],
  running: [77, 159, 255],
  done: [52, 209, 123],
  error: [244, 102, 92]
}

const cache = new Map<string, NativeImage>()

/**
 * 程序化绘制状态指示灯图标（实心圆 + 可选辉光），免去二进制图标资源。
 * 用于托盘图标与任务栏 overlay 角标。
 */
export function stateIcon(state: IconState, glow = false): NativeImage {
  const key = `${state}:${glow}`
  const hit = cache.get(key)
  if (hit) return hit

  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  const [r, g, b] = COLORS[state]
  const c = (size - 1) / 2
  const rCore = glow ? 8.5 : 9.5
  const rGlow = 15

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      let a = 0
      if (d <= rCore) a = 1
      else if (d <= rCore + 1.5) a = (rCore + 1.5 - d) / 1.5 // 边缘抗锯齿
      if (glow && d > rCore && d <= rGlow) {
        a = Math.max(a, 0.5 * (1 - (d - rCore) / (rGlow - rCore)))
      }
      const i = (y * size + x) * 4
      // BGRA，预乘 alpha
      buf[i] = Math.round(b * a)
      buf[i + 1] = Math.round(g * a)
      buf[i + 2] = Math.round(r * a)
      buf[i + 3] = Math.round(a * 255)
    }
  }

  const img = nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 })
  cache.set(key, img)
  return img
}
