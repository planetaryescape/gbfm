export const scrubberProgress = (seconds: number, duration: number) => {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(seconds)) return 0

  return Math.max(0, Math.min(1, seconds / duration))
}

export const scrubberTime = (x: number, width: number, duration: number) => {
  if (!Number.isFinite(width) || width <= 0) return 0

  return scrubberProgress(x, width) * (Number.isFinite(duration) ? Math.max(0, duration) : 0)
}

export const scrubberCurve = (progress: number) => {
  const x = 56 + scrubberProgress(progress, 1) * 208
  const left = x - 44
  const right = x + 44
  const rise = `M 12 44 L ${left} 44 C ${x - 19.8} 44 ${x - 19.8} 18 ${x} 18`

  return {
    x,
    played: rise,
    track: `${rise} C ${x + 19.8} 18 ${x + 19.8} 44 ${right} 44 L 308 44`,
  }
}

export const startScrubberDrag = (
  x: number,
  width: number,
  currentTime: number,
  duration: number,
) => {
  const center = (scrubberCurve(scrubberProgress(currentTime, duration)).x / 320) * width
  const onHill = Math.abs(x - center) <= (44 / 320) * width
  const offset = onHill ? x - center : 0

  return {
    timeAt: (pointerX: number) =>
      scrubberTime(pointerX - offset - (56 / 320) * width, (208 / 320) * width, duration),
  }
}
