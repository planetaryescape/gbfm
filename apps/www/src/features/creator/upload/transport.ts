import { Context, Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'

export class UploadTransport extends Context.Service<
  UploadTransport,
  { readonly fetch: (url: string, init: RequestInit) => Promise<Response> }
>()('@gbfm/www/UploadTransport') {}

export const UploadTransportLive = Layer.effect(
  UploadTransport,
  Effect.gen(function* () {
    const fetch = yield* FetchHttpClient.Fetch

    return UploadTransport.of({ fetch: (url, init) => fetch(url, init) })
  }),
)
