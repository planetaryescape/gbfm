import { Data, Effect } from 'effect'

import { LoginFailed } from '@/api/auth'

import type { AuthSession } from './authLifecycle'

export type LoginSubmission =
  | { readonly _tag: 'Idle' }
  | { readonly _tag: 'Submitting' }
  | { readonly _tag: 'Failed'; readonly message: string }

export const LoginSubmission = Data.taggedEnum<LoginSubmission>()

export const idleLoginSubmission = LoginSubmission.Idle()

export const submitLogin = <E, R>(
  request: Effect.Effect<AuthSession, E, R>,
  updateState: (update: (current: LoginSubmission) => LoginSubmission) => void,
  onSignedIn: () => void,
) =>
  Effect.sync(() => updateState(() => LoginSubmission.Submitting())).pipe(
    Effect.andThen(request),
    Effect.tap(() => Effect.sync(onSignedIn)),
    Effect.catch((error) =>
      Effect.sync(() =>
        updateState(() =>
          LoginSubmission.Failed({
            message: error instanceof LoginFailed ? error.message : 'Unable to sign in right now.',
          }),
        ),
      ),
    ),
    Effect.ensuring(
      Effect.sync(() =>
        updateState((current) =>
          LoginSubmission.$is('Submitting')(current) ? idleLoginSubmission : current,
        ),
      ),
    ),
    Effect.asVoid,
  )
