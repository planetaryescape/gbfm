import { useCallback } from 'react'

export function useStepAnnouncement(label: string, announce: (label: string) => void) {
  return useCallback(() => {
    const timer = setTimeout(() => announce(label), 0)

    return () => clearTimeout(timer)
  }, [label, announce])
}
