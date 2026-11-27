import { Command, Component } from '@effect/ui'
import { MicroPostSeenResponse } from '@gbfm/api/navigation'
import { Effect, Layer, Schema } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'

import { ReaderCheckpointStore } from './checkpoint-store'
import { ReaderPageMessage, VisitToken } from './contracts'

export class RecordVisit extends Command.Service<RecordVisit>()('reader/RecordVisit', {
  args: VisitToken.fields,
  success: ReaderPageMessage,
}) {
  static readonly layer = this.toLayer(
    Effect.map(
      HttpClient.HttpClient,
      (client) => (token) =>
        client.post(`/api/content/posts/micro/${encodeURIComponent(token.slug)}/seen`).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(MicroPostSeenResponse)),
          Effect.match({
            onFailure: () => ReaderPageMessage.FailedRecordVisit(token),
            onSuccess: ({ recorded }) =>
              recorded
                ? ReaderPageMessage.SucceededRecordVisit(token)
                : ReaderPageMessage.FailedRecordVisit(token),
          }),
        ),
    ),
  )
}

export class StoreCheckpoint extends Command.Service<StoreCheckpoint>()('reader/StoreCheckpoint', {
  args: { identity: Schema.String, slug: Schema.NullOr(Schema.String) },
  success: Component.Noop,
}) {
  static readonly layer = this.toLayer(
    Effect.map(
      ReaderCheckpointStore,
      (store) =>
        ({ identity, slug }) =>
          store.write(identity, slug).pipe(Effect.as(Component.noop)),
    ),
  )
}

export class ResolveCheckpoint extends Command.Service<ResolveCheckpoint>()(
  'reader/ResolveCheckpoint',
  {
    args: { identity: Schema.String, generation: Schema.Number, navigationId: Schema.Number },
    success: ReaderPageMessage,
  },
) {
  static readonly layer = this.toLayer(
    Effect.map(
      ReaderCheckpointStore,
      (store) =>
        ({ identity, generation, navigationId }) =>
          store.read(identity).pipe(
            Effect.map((slug) =>
              ReaderPageMessage.ResolvedCheckpoint({
                identity,
                generation,
                navigationId,
                slug,
              }),
            ),
          ),
    ),
  )
}

export const readerCommandsLayer = Layer.mergeAll(
  RecordVisit.layer,
  StoreCheckpoint.layer,
  ResolveCheckpoint.layer,
)
