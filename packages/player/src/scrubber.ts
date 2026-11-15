export const scrubberProgress = (seconds: number, duration: number) => {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(seconds)) return 0

  return Math.max(0, Math.min(1, seconds / duration))
}

export const scrubberTime = (x: number, width: number, duration: number) => {
  if (!Number.isFinite(width) || width <= 0) return 0

  return scrubberProgress(x, width) * (Number.isFinite(duration) ? Math.max(0, duration) : 0)
}

export const scrubberCurve = (progress: number) => {
  const x = 12 + scrubberProgress(progress, 1) * 296
  const left = Math.max(12, x - 44)
  const right = Math.min(308, x + 44)
  const rise = `M 12 44 L ${left} 44 C ${left + (x - left) * 0.55} 44 ${x - (x - left) * 0.45} 22 ${x} 22`

  return {
    x,
    played: rise,
    track: `${rise} C ${x + (right - x) * 0.45} 22 ${right - (right - x) * 0.55} 44 ${right} 44 L 308 44`,
  }
}
