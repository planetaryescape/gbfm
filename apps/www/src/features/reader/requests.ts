import { Query } from '@effect/ui'
import { MicroPostNeighboursResponse } from '@gbfm/api/navigation'
import { MicroPostScreenRepliesResponse } from '@gbfm/api/post'
import { Effect, Schema } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'

import { NavigationSnapshot } from './contracts'

export class ReaderUnavailable extends Schema.TaggedError<ReaderUnavailable>()(
  'ReaderUnavailable',
  { resource: Schema.String },
) {}

export class ReaderNeighbours extends Query.Service<ReaderNeighbours>()('reader/ReaderNeighbours', {
  args: {
    identity: Schema.String,
    generation: Schema.Number,
    slug: Schema.String,
    navigationId: Schema.Number,
    revision: Schema.Number,
    refresh: Schema.Number,
  },
  success: NavigationSnapshot,
  error: ReaderUnavailable,
  staleTime: 0,
}) {
  static readonly layer = this.toLayer(
    Effect.map(
      HttpClient.HttpClient,
      (client) => (token) =>
        client.get(`/api/content/posts/micro/${encodeURIComponent(token.slug)}/neighbours`).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(MicroPostNeighboursResponse)),
          Effect.map((neighbours) => ({ ...token, neighbours })),
          Effect.mapError(() => new ReaderUnavailable({ resource: 'navigation' })),
        ),
    ),
  )
}

export class ReaderReplies extends Query.Service<ReaderReplies>()('reader/ReaderReplies', {
  args: {
    identity: Schema.String,
    generation: Schema.Number,
    slug: Schema.String,
    navigationId: Schema.Number,
  },
  success: MicroPostScreenRepliesResponse,
  error: ReaderUnavailable,
  staleTime: 0,
}) {
  static readonly layer = this.toLayer(
    Effect.map(
      HttpClient.HttpClient,
      (client) =>
        ({ slug }) =>
          client.get(`/api/content/posts/micro/${encodeURIComponent(slug)}/screen/replies`).pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap(HttpClientResponse.schemaBodyJson(MicroPostScreenRepliesResponse)),
            Effect.mapError(() => new ReaderUnavailable({ resource: 'replies' })),
          ),
    ),
  )
}
