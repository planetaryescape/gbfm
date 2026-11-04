import { Data } from 'effect'

type Motion =
  | { readonly _tag: 'Idle' }
  | { readonly _tag: 'Dragging' }
  | { readonly _tag: 'Returning' }
  | { readonly _tag: 'Exiting' }
  | {
      readonly _tag: 'AwaitingDestination'
      readonly slug: string
      readonly direction: 'older' | 'newer'
    }
  | { readonly _tag: 'Entering' }

const Motion = Data.taggedEnum<Motion>()

export const createSwipeMotion = () => {
  let element: HTMLElement | null = null
  let animation: Animation | null = null
  let phase: Motion = Motion.Idle()
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')

  const busy = () =>
    Motion.$match(phase, {
      Idle: () => false,
      Dragging: () => false,
      Returning: () => false,
      Exiting: () => true,
      AwaitingDestination: () => true,
      Entering: () => true,
    })

  const stop = () => {
    animation?.cancel()
    animation = null
    element?.style.removeProperty('transform')
    element?.style.removeProperty('opacity')
    element?.removeAttribute('data-swipe-phase')
  }

  const reset = () => {
    stop()
    phase = Motion.Idle()
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
    if (!Motion.$is('AwaitingDestination')(phase)) return

    const surface = document.querySelector('[data-tweet-swipe]')
    const slug = surface?.getAttribute('data-tweet-swipe')

    if (!slug) {
      reset()

      return
    }

    if (slug === phase.slug) return

    const direction = phase.direction
    stop()
    phase = Motion.Entering()
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
    busy,
    drag: (surface: Element, offset: number) => {
      if (busy()) return
      const target = surface.querySelector('[data-tweet-motion]')

      if (!(target instanceof HTMLElement)) return
      stop()
      element = target
      phase = Motion.Dragging()
      element.setAttribute('data-swipe-phase', 'dragging')
      element.style.transform = `translateX(${reduced.matches ? 0 : offset}px)`
    },
    rebound: () => {
      if (!element || busy()) return
      const transform = getComputedStyle(element).transform
      stop()
      phase = Motion.Returning()
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
      phase = Motion.Exiting()
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
          phase = Motion.AwaitingDestination({ slug, direction })
          navigate()
        },
      )
    },
    navigationEnded: () => {
      if (
        Motion.$is('AwaitingDestination')(phase) &&
        document.querySelector('[data-tweet-swipe]')?.getAttribute('data-tweet-swipe') ===
          phase.slug
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
