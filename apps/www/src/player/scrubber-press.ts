import { Effect } from 'effect'
import { Mount } from 'foldkit'

import { Message } from './model'

export const ScrubberPress = Mount.define('Player.ScrubberPress', {
  args: {},
  messages: [Message.OperationCompleted],
  execute: ({ element }) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const press = () => {
          if (element.querySelector('input:disabled')) return
          element.setAttribute('data-pressed', '')
        }

        const release = () => element.removeAttribute('data-pressed')

        const pointerDown = (event: Event) => {
          if (event instanceof PointerEvent && event.pointerType !== 'touch' && event.button === 0)
            press()
        }

        const pointerUp = (event: Event) => {
          if (event instanceof PointerEvent && event.pointerType !== 'touch') release()
        }

        element.addEventListener('pointerdown', pointerDown)
        element.addEventListener('touchstart', press, { passive: true })
        document.addEventListener('pointerup', pointerUp)
        document.addEventListener('pointercancel', pointerUp)
        document.addEventListener('touchend', release)
        document.addEventListener('touchcancel', release)
        window.addEventListener('blur', release)

        return () => {
          release()
          element.removeEventListener('pointerdown', pointerDown)
          element.removeEventListener('touchstart', press)
          document.removeEventListener('pointerup', pointerUp)
          document.removeEventListener('pointercancel', pointerUp)
          document.removeEventListener('touchend', release)
          document.removeEventListener('touchcancel', release)
          window.removeEventListener('blur', release)
        }
      }),
      (cleanup) => Effect.sync(cleanup),
    ).pipe(Effect.as(Message.OperationCompleted())),
})
