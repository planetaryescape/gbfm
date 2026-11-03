import { Context, Layer } from 'effect'

export class UploadTransport extends Context.Service<
  UploadTransport,
  { readonly fetch: (url: string, init: RequestInit) => Promise<Response> }
>()('@gbfm/www/UploadTransport') {}

export const UploadTransportLive = Layer.succeed(UploadTransport, {
  fetch: (url, init) => fetch(url, init),
})
