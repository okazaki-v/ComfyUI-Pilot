let ctx: AudioContext | null = null

function ensureCtx(): AudioContext {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(
  ac: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  peak: number,
  type: OscillatorType = 'sine'
): void {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(peak, startAt + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  osc.connect(gain).connect(ac.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.05)
}

/** 完成：明亮的两音上行；错误：低沉的两音下行 */
export function playChime(kind: 'done' | 'error'): void {
  const ac = ensureCtx()
  const t = ac.currentTime + 0.02
  if (kind === 'done') {
    tone(ac, 880, t, 0.22, 0.18)
    tone(ac, 1318.5, t + 0.13, 0.4, 0.16)
  } else {
    tone(ac, 330, t, 0.25, 0.16, 'triangle')
    tone(ac, 220, t + 0.18, 0.4, 0.16, 'triangle')
  }
}
