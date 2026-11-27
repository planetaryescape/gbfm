import { Mount, UiSchema } from '@effect/ui'
import { Effect, Queue, Stream } from 'effect'

export const AuthSubmissionMessage = UiSchema.TaggedEnum({
  SubmittedAuthForm: {},
  RestoredAuthForm: {},
})

export const TrackAuthSubmission = Mount.makeStream(
  'TrackAuthSubmission',
  { args: {} },
  (element: HTMLFormElement) =>
    Stream.callback<typeof AuthSubmissionMessage.Type>((queue) =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const submitted = () => {
              Queue.offerUnsafe(queue, AuthSubmissionMessage.SubmittedAuthForm())
            }

            const restored = () => {
              Queue.offerUnsafe(queue, AuthSubmissionMessage.RestoredAuthForm())
            }

            element.addEventListener('submit', submitted)
            window.addEventListener('pageshow', restored)

            return () => {
              element.removeEventListener('submit', submitted)
              window.removeEventListener('pageshow', restored)
            }
          }),
          (cleanup) => Effect.sync(cleanup),
        )

        return yield* Effect.never
      }),
    ),
)
