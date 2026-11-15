import { useEffect, useRef, useState } from 'react'

export function useVideoSession(pause: () => Promise<boolean>) {
  const [visible, setVisible] = useState(false)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)

  useEffect(
    () => () => {
      generation.current += 1
    },
    [],
  )

  const close = () => {
    generation.current += 1
    setVisible(false)
  }

  const open = async () => {
    const owner = ++generation.current
    setFailed(false)

    try {
      const paused = await pause()

      if (generation.current !== owner) return
      setVisible(paused)
      setFailed(!paused)
    } catch {
      if (generation.current === owner) setFailed(true)
    }
  }

  return { visible, failed, open, close }
}
