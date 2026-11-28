import { Query } from '@effect/ui'
import { RichContentDiagnostic, RichContentDocument } from '@gbfm/rich-content/schema'
import { Effect, Schema } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'

import { Editable, Kind } from './domain'
import { EditableResponse, editableDraft } from './editable'
import { CreatorIdentity, MusicReference } from './services'

export class GetEditable extends Query.Service<GetEditable>()('creator/GetEditable', {
  args: { kind: Kind, slug: Schema.String, principalId: Schema.String, attempt: Schema.Number },
  success: Editable,
  error: Schema.String,
  staleTime: '0 millis',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient

      return ({ kind, slug, principalId }) =>
        client
          .get(
            kind === 'mix'
              ? `/api/content/audio/mix/${encodeURIComponent(slug)}/edit`
              : `/api/content/posts/${encodeURIComponent(slug)}/edit`,
          )
          .pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap(HttpClientResponse.schemaBodyJson(EditableResponse)),
            Effect.map((item) => editableDraft(item, kind, slug, principalId)),
            Effect.mapError(() => 'Could not load this draft.'),
          )
    }),
  )
}

export class SearchAuthors extends Query.Service<SearchAuthors>()('creator/SearchAuthors', {
  args: { query: Schema.String, principalId: Schema.String, attempt: Schema.Number },
  success: Schema.Array(CreatorIdentity),
  error: Schema.String,
  staleTime: '30 seconds',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient

      return ({ query }) =>
        client.get(`/api/user/search?q=${encodeURIComponent(query)}`).pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(CreatorIdentity))),
          Effect.mapError(() => 'Could not search authors.'),
        )
    }),
  )
}

export class GetPreview extends Query.Service<GetPreview>()('creator/GetPreview', {
  args: { content: Schema.String, principalId: Schema.String, attempt: Schema.Number },
  success: RichContentDocument,
  error: Schema.String,
  staleTime: '30 seconds',
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient

      return ({ content }) =>
        client
          .execute(
            HttpClientRequest.post('/api/content/posts/preview').pipe(
              HttpClientRequest.bodyJsonUnsafe({ content }),
            ),
          )
          .pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(
                Schema.Struct({ richContent: RichContentDocument }),
              ),
            ),
            Effect.map(({ richContent }) => richContent),
            Effect.mapError(() => 'Could not render preview.'),
          )
    }),
  )
}

export class GetMusicReferences extends Query.Service<GetMusicReferences>()(
  'creator/GetMusicReferences',
  {
    args: {
      entityType: Schema.Literals(['album', 'track', 'playlist']),
      entityId: Schema.String,
      offset: Schema.Number,
      attempt: Schema.Number,
    },
    success: Schema.Struct({
      data: Schema.Array(MusicReference),
      pagination: Schema.Struct({ hasMore: Schema.Boolean }),
    }),
    error: Schema.String,
    staleTime: '30 seconds',
  },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient

      return ({ entityType, entityId, offset }) =>
        client
          .get(
            `/api/content/posts/micro?${new URLSearchParams({
              musicEntityType: entityType,
              musicEntityId: entityId,
              offset: String(offset),
              limit: '20',
            })}`,
          )
          .pipe(
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap(
              HttpClientResponse.schemaBodyJson(
                Schema.Struct({
                  data: Schema.Array(MusicReference),
                  pagination: Schema.Struct({ hasMore: Schema.Boolean }),
                }),
              ),
            ),
            Effect.mapError(() => 'Could not find music references.'),
          )
    }),
  )
}

const CatalogueItem = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  coverImageUrl: Schema.optional(Schema.NullOr(Schema.String)),
  artistNames: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
})

export const MusicChoice = Schema.Struct({
  entityType: Schema.Literals(['album', 'track', 'playlist']),
  entityId: Schema.String,
  title: Schema.String,
  artists: Schema.String,
  image: Schema.NullOr(Schema.String),
})

export class GetMusicCatalogue extends Query.Service<GetMusicCatalogue>()(
  'creator/GetMusicCatalogue',
  {
    args: { principalId: Schema.String },
    success: Schema.Array(MusicChoice),
    error: Schema.String,
    staleTime: '1 minute',
  },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient

      return () =>
        Effect.gen(function* () {
          const kinds: ReadonlyArray<'album' | 'track' | 'playlist'> = [
            'album',
            'track',
            'playlist',
          ]

          const groups = yield* Effect.forEach(
            kinds,
            (entityType) =>
              Effect.gen(function* () {
                const items = yield* client.get(`/api/music/${entityType}s`).pipe(
                  Effect.flatMap(HttpClientResponse.filterStatusOk),
                  Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(CatalogueItem))),
                  Effect.mapError(() => 'Could not search the music catalogue.'),
                )

                return items.map((item) => ({
                  entityType,
                  entityId: item.id,
                  title: item.title,
                  artists: (item.artistNames ?? []).join(', '),
                  image: item.coverImageUrl ?? null,
                }))
              }),
            { concurrency: 3 },
          )

          return groups.flat()
        })
    }),
  )
}

export class GetDiagnostics extends Query.Service<GetDiagnostics>()('creator/GetDiagnostics', {
  args: { content: Schema.String, principalId: Schema.String },
  success: Schema.Array(RichContentDiagnostic),
  error: Schema.String,
  staleTime: '1 minute',
}) {
  static readonly layer = this.toLayer(({ content }) =>
    Effect.tryPromise({
      try: () => import('@gbfm/rich-content/source'),
      catch: () => 'Could not check source diagnostics.',
    }).pipe(Effect.map(({ parseRichContent }) => parseRichContent(content).diagnostics)),
  )
}
