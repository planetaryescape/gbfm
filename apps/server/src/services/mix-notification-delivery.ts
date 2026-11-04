import { Data, Effect, Predicate } from 'effect'

type MixNotificationRecipientOutcome =
  | { readonly _tag: 'sent'; readonly recipient: string; readonly emailId: string }
  | { readonly _tag: 'skipped'; readonly recipient: string }
  | { readonly _tag: 'failed'; readonly recipient: string }

export const MixNotificationRecipientOutcome = Data.taggedEnum<MixNotificationRecipientOutcome>()

const MIX_NOTIFICATION_SEND_CONCURRENCY = 5

export const deliverMixNotificationRecipients = <E, R>(
  recipients: ReadonlyArray<string>,
  deliver: (recipient: string) => Effect.Effect<MixNotificationRecipientOutcome, E, R>,
) =>
  Effect.gen(function* () {
    const outcomes = yield* Effect.forEach(recipients, deliver, {
      concurrency: MIX_NOTIFICATION_SEND_CONCURRENCY,
    })

    return {
      sentTo: outcomes.flatMap((outcome) =>
        Predicate.isTagged('sent')(outcome) ? [outcome.recipient] : [],
      ),
      skipped: outcomes.flatMap((outcome) =>
        Predicate.isTagged('skipped')(outcome) ? [outcome.recipient] : [],
      ),
      errors: outcomes.flatMap((outcome) =>
        Predicate.isTagged('failed')(outcome) ? [outcome.recipient] : [],
      ),
      emailIds: outcomes.flatMap((outcome) =>
        Predicate.isTagged('sent')(outcome) ? [outcome.emailId] : [],
      ),
    }
  })
