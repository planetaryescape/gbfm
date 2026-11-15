import { Api } from '@gbfm/api/api'
import { Data, Effect, Predicate } from 'effect'
import { HttpApiClient } from 'effect/http-api'

import type { ReaderConnection } from './tweetReader'

export class EditorialUnavailable extends Data.TaggedError('EditorialUnavailable') {}

export class EditorialMissing extends Data.TaggedError('EditorialMissing') {}

export const loadEditorial = (connection: ReaderConnection, slug: string) =>
  Effect.gen(function* () {
    const posts = yield* HttpApiClient.group(Api, {
      group: 'post',
      baseUrl: connection.baseUrl,
      httpClient: connection.httpClient,
    })

    return yield* posts.getEditorialPostBySlug({ params: { slug } })
  }).pipe(
    Effect.mapError((error) =>
      Predicate.isTagged(error, 'NotFound') ? new EditorialMissing() : new EditorialUnavailable(),
    ),
  )
