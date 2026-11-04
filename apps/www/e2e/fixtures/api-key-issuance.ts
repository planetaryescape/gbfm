import { Effect, Fiber, Predicate, Queue, Stream } from 'effect'

import { IssueKey } from '../../src/page/dashboard/page/api-keys/issuance'

export const mountIssuanceFixture = () => {
  const element = document.getElementById('fixture')
  const dialog = document.querySelector('dialog')

  if (!element || !(dialog instanceof HTMLDialogElement)) throw new Error('Missing fixture')
  const changes = Effect.runSync(Queue.unbounded<'Live' | 'Paused'>())
  let viewVersion = 0
  Queue.offerUnsafe(changes, 'Live')

  const fiber = Effect.runFork(
    IssueKey({ userId: 'owner' })
      .f(
        element,
        Stream.fromQueue(changes).pipe(
          Stream.map((state) => {
            element.dataset.viewState = state
            element.dataset.viewVersion = String(++viewVersion)

            return state
          }),
        ),
      )
      .pipe(
        Stream.runForEach((message) =>
          Effect.sync(() => {
            element.dataset.message = message._tag

            if (Predicate.isTagged(message, 'PasswordRequested')) dialog.showModal()

            if (Predicate.isTagged(message, 'PasswordVerificationFailed')) {
              element.dataset.failure = message.message
            }

            if (Predicate.isTagged(message, 'Issued')) dialog.close()
          }),
        ),
      ),
  )

  window.addEventListener('fixture:pause', () => {
    Queue.offerUnsafe(changes, 'Paused')
  })
  window.addEventListener('fixture:live', () => {
    Queue.offerUnsafe(changes, 'Live')
  })
  window.addEventListener('fixture:dispose', () => {
    Effect.runFork(Fiber.interrupt(fiber))
  })
}
