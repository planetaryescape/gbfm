import { Context, Effect, Schema } from 'effect'

import { TweetDraft } from './draft'

export type ComposerScope = { readonly principal: string; readonly storageKey: string }

const fields = {
  version: Schema.Literal(1),
  principal: Schema.NonEmptyString,
  storageKey: Schema.NonEmptyString,
  draft: TweetDraft,
  replying: Schema.Boolean,
}

export const PendingPublication = Schema.TaggedStruct('Pending', fields)

export const ConfirmedPublication = Schema.TaggedStruct('Confirmed', {
  ...fields,
  slug: Schema.NonEmptyString,
})

export const ComposerReceipt = Schema.Union([PendingPublication, ConfirmedPublication])

export type ComposerReceipt = typeof ComposerReceipt.Type

export type ConfirmedPublication = Extract<ComposerReceipt, { readonly _tag: 'Confirmed' }>

export class ComposerReceiptFailed extends Schema.TaggedError<ComposerReceiptFailed>()(
  'ComposerReceiptFailed',
  { message: Schema.String },
) {}

export class ComposerReceiptStorage extends Context.Service<
  ComposerReceiptStorage,
  {
    readonly read: (
      scope: ComposerScope,
    ) => Effect.Effect<ComposerReceipt | null, ComposerReceiptFailed>
    readonly write: (receipt: ComposerReceipt) => Effect.Effect<void, ComposerReceiptFailed>
    readonly remove: (scope: ComposerScope) => Effect.Effect<void, ComposerReceiptFailed>
  }
>()('mobile/ComposerReceiptStorage') {}

const scoped = ({ principal, storageKey }: ComposerScope) =>
  principal !== 'guest' &&
  principal.length > 0 &&
  (storageKey === principal ||
    storageKey.startsWith(`${principal}/edit/`) ||
    storageKey.startsWith(`${principal}/reply/`))

export const composerReceiptKey = ({ principal, storageKey }: ComposerScope) =>
  `gbfm-tweet-publication-v1-${encodeURIComponent(JSON.stringify([principal, storageKey]))}.json`

export const receiptStorageFromLocal = <E>(local: {
  readonly read: (key: string) => Effect.Effect<string | null, E>
  readonly write: (key: string, value: string) => Effect.Effect<void, E>
  readonly remove: (key: string) => Effect.Effect<void, E>
}): typeof ComposerReceiptStorage.Service => {
  const unavailable = () =>
    new ComposerReceiptFailed({
      message:
        'Could not read or save publication recovery data. Your draft has not been overwritten.',
    })

  const check = (scope: ComposerScope): Effect.Effect<void, ComposerReceiptFailed> =>
    scoped(scope) ? Effect.void : Effect.fail(unavailable())

  return {
    read: (scope) =>
      check(scope).pipe(
        Effect.andThen(() => local.read(composerReceiptKey(scope))),
        Effect.flatMap((raw) =>
          raw === null
            ? Effect.succeed(null)
            : Schema.decodeUnknownEffect(Schema.fromJsonString(ComposerReceipt))(raw).pipe(
                Effect.flatMap((receipt) =>
                  receipt.principal === scope.principal && receipt.storageKey === scope.storageKey
                    ? Effect.succeed(receipt)
                    : Effect.fail(unavailable()),
                ),
              ),
        ),
        Effect.mapError(unavailable),
      ),
    write: (receipt) =>
      check(receipt).pipe(
        Effect.andThen(() => local.write(composerReceiptKey(receipt), JSON.stringify(receipt))),
        Effect.mapError(unavailable),
      ),
    remove: (scope) =>
      check(scope).pipe(
        Effect.andThen(() => local.remove(composerReceiptKey(scope))),
        Effect.mapError(unavailable),
      ),
  }
}
