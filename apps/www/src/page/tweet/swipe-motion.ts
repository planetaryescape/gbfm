export const createSwipeMotion = () => {
  let element: HTMLElement | null = null
  let animation: Animation | null = null
  let pending: { readonly slug: string; readonly direction: 'older' | 'newer' } | null = null
  let busy = false
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')

  const stop = () => {
    animation?.cancel()
    animation = null
    element?.style.removeProperty('transform')
    element?.style.removeProperty('opacity')
    element?.removeAttribute('data-swipe-phase')
  }

  const reset = () => {
    stop()
    pending = null
    busy = false
  }

  const animate = (frames: Array<Keyframe>, duration: number, easing: string, done: () => void) => {
    if (!element || reduced.matches) {
      done()

      return
    }

    const current = element.animate(frames, { duration, easing, fill: 'forwards' })
    animation = current
    current.finished.then(
      () => {
        if (animation === current) done()
      },
      () => {},
    )
  }

  const observer = new MutationObserver(() => {
    if (!pending) return

    const surface = document.querySelector('[data-tweet-swipe]')
    const slug = surface?.getAttribute('data-tweet-swipe')

    if (!slug) {
      reset()

      return
    }

    if (slug === pending.slug) return

    const direction = pending.direction
    stop()
    pending = null
    const next = surface?.querySelector('[data-tweet-motion]')

    if (!(next instanceof HTMLElement)) {
      reset()

      return
    }

    element = next
    element.setAttribute('data-swipe-phase', 'entering')
    animate(
      [
        { transform: `translateX(${direction === 'older' ? 48 : -48}px)`, opacity: 0.6 },
        { transform: 'translateX(0)', opacity: 1 },
      ],
      220,
      'cubic-bezier(0.22, 1, 0.36, 1)',
      reset,
    )
  })

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-tweet-swipe'],
  })

  return {
    busy: () => busy,
    drag: (surface: Element, offset: number) => {
      if (busy) return
      const target = surface.querySelector('[data-tweet-motion]')

      if (!(target instanceof HTMLElement)) return
      stop()
      element = target
      element.setAttribute('data-swipe-phase', 'dragging')
      element.style.transform = `translateX(${reduced.matches ? 0 : offset}px)`
    },
    rebound: () => {
      if (!element || busy) return
      const transform = getComputedStyle(element).transform
      stop()
      element.setAttribute('data-swipe-phase', 'returning')
      animate(
        [{ transform }, { transform: 'translateX(0)' }],
        260,
        'cubic-bezier(0.22, 1, 0.36, 1)',
        reset,
      )
    },
    commit: (
      surface: Element,
      slug: string,
      direction: 'older' | 'newer',
      navigate: () => void,
    ) => {
      const target = surface.querySelector('[data-tweet-motion]')

      if (!(target instanceof HTMLElement)) return

      const transform = getComputedStyle(target).transform
      stop()
      element = target
      busy = true
      element.setAttribute('data-swipe-phase', 'exiting')
      animate(
        [
          { transform, opacity: 1 },
          {
            transform: `translateX(${direction === 'older' ? -24 : 24}px)`,
            opacity: 1,
          },
        ],
        170,
        'cubic-bezier(0.4, 0, 1, 1)',
        () => {
          pending = { slug, direction }
          navigate()
        },
      )
    },
    navigationEnded: () => {
      if (
        pending &&
        document.querySelector('[data-tweet-swipe]')?.getAttribute('data-tweet-swipe') ===
          pending.slug
      )
        reset()
    },
    reset,
    dispose: () => {
      observer.disconnect()
      reset()
    },
  }
}
