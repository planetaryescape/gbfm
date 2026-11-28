import { Effect, Layer } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'

export const siteHttpClientLayer = (origin: URL) =>
  HttpClient.layerMergedContext(
    Effect.map(HttpClient.HttpClient, (client) =>
      HttpClient.mapRequest(client, (request) =>
        HttpClientRequest.setUrl(request, new URL(request.url, origin).href),
      ),
    ),
  ).pipe(Layer.provide(FetchHttpClient.layer))
