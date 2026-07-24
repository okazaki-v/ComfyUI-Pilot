// 程序化生成应用图标 build/icon.ico（内嵌 PNG 的 ICO），零依赖。
// 视觉与应用内 logo 一致：品牌蓝→青绿渐变圆角方块 + 白色指示灯圆点。
// 用法：node scripts/gen-icon.mjs
import { deflateSync } from 'zlib'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const SIZE = 256
const RADIUS = 58
const FROM = [0x4d, 0x9f, 0xff] // --brand
const TO = [0x7e, 0xe0, 0xc0]

function roundedRectAlpha(x, y) {
  const min = 8
  const max = SIZE - 1 - min
  const cx = Math.min(Math.max(x, min + RADIUS), max - RADIUS)
  const cy = Math.min(Math.max(y, min + RADIUS), max - RADIUS)
  const d = Math.hypot(x - cx, y - cy)
  if (x < min || x > max || y < min || y > max) return 0
  return Math.min(1, Math.max(0, RADIUS - d + 1))
}

function circleAlpha(x, y, cx, cy, r) {
  const d = Math.hypot(x - cx, y - cy)
  return Math.min(1, Math.max(0, r - d + 1))
}

// RGBA 像素
const px = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const a = roundedRectAlpha(x, y)
    const t = (x + y) / (2 * (SIZE - 1))
    let r = FROM[0] + (TO[0] - FROM[0]) * t
    let g = FROM[1] + (TO[1] - FROM[1]) * t
    let b = FROM[2] + (TO[2] - FROM[2]) * t
    // 白色指示灯圆点（略偏上），小尺寸下仍可辨识
    const dot = circleAlpha(x, y, SIZE / 2, SIZE / 2 - 6, 44)
    const glow = Math.min(1, Math.max(0, 1 - (Math.hypot(x - SIZE / 2, y - SIZE / 2 + 6) - 44) / 40)) * 0.25
    const w = Math.min(1, dot + (dot > 0 ? 0 : glow))
    r = r + (255 - r) * w
    g = g + (255 - g) * w
    b = b + (255 - b) * w
    const i = (y * SIZE + x) * 4
    px[i] = Math.round(r)
    px[i + 1] = Math.round(g)
    px[i + 2] = Math.round(b)
    px[i + 3] = Math.round(a * 255)
  }
}

// ---- PNG 编码 ----
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0 // filter: none
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

// ---- ICO 封装（单条目，256x256 PNG） ----
const ico = Buffer.alloc(22 + png.length)
ico.writeUInt16LE(0, 0) // reserved
ico.writeUInt16LE(1, 2) // type: icon
ico.writeUInt16LE(1, 4) // count
ico[6] = 0 // width 256
ico[7] = 0 // height 256
ico[8] = 0 // palette
ico[9] = 0 // reserved
ico.writeUInt16LE(1, 10) // planes
ico.writeUInt16LE(32, 12) // bpp
ico.writeUInt32LE(png.length, 14)
ico.writeUInt32LE(22, 18) // offset
png.copy(ico, 22)

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.ico')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, ico)
console.log(`icon written: ${out} (${ico.length} bytes)`)
