const safeSeconds = (seconds: number) =>
  Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0

export const formatScrubberTime = (seconds: number, duration: number): string => {
  const safe = safeSeconds(seconds)
  const remainder = String(safe % 60).padStart(2, '0')

  if (safeSeconds(duration) >= 3600) {
    const minutes = String(Math.floor((safe % 3600) / 60)).padStart(2, '0')

    return `${Math.floor(safe / 3600)}:${minutes}:${remainder}`
  }

  return `${Math.floor(safe / 60)}:${remainder}`
}

export const formatScrubberDelta = (
  seconds: number,
  referenceSeconds: number,
  duration: number,
): string => {
  const delta = safeSeconds(seconds) - safeSeconds(referenceSeconds)
  const prefix = delta < 0 ? '-' : '+'

  return `${prefix}${formatScrubberTime(Math.abs(delta), duration)}`
}
