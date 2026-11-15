import { Api } from '@gbfm/api/api'
import { Data, Effect, Predicate } from 'effect'
import { HttpApiClient } from 'effect/http-api'

import { env } from '@/env'

import { getHttpClient } from './client'
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

export const readEditorial = (slug: string) =>
  getHttpClient.pipe(
    Effect.mapError(() => new EditorialUnavailable()),
    Effect.flatMap((httpClient) =>
      loadEditorial({ httpClient, baseUrl: env.EXPO_PUBLIC_API_URL, sessionToken: null }, slug),
    ),
  )
