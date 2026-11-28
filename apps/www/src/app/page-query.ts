import { Query } from '@effect/ui'
import { Effect, Schema } from 'effect'

import { PageDocument } from '../domain/page'
import { parseRoute } from '../route'
import type { loadPageData } from '../server/page-data'
import { isPageUrl, isPrivatePageUrl } from './route'

export const PageIdentity = Schema.Struct({
  principalId: Schema.NullOr(Schema.String),
  known: Schema.Boolean,
  epoch: Schema.Number,
})

export type PageIdentity = typeof PageIdentity.Type

export const PageQueryArgs = Schema.Struct({
  path: Schema.String.check(Schema.isPattern(/^\/(?!\/)[^#]*$/)).check(
    Schema.makeFilter((path: string) => {
      const url = URL.parse(path, 'http://gbfm.invalid')

      return url !== null && isPageUrl(url)
    }),
  ),
  identity: PageIdentity,
  realm: Schema.String.check(Schema.isMinLength(1)),
})

export type PageQueryArgs = typeof PageQueryArgs.Type

export class PageQueryError extends Schema.TaggedError<PageQueryError>()('PageQueryError', {
  reason: Schema.Literals(['transport', 'document', 'identity', 'origin', 'redirect']),
  status: Schema.Number,
  requestId: Schema.NullOr(Schema.String),
  location: Schema.NullOr(Schema.String),
}) {}

export class GetPage extends Query.Service<GetPage>()('gbfm/GetPage', {
  args: PageQueryArgs,
  success: PageDocument,
  error: PageQueryError,
  staleTime: '30 seconds',
  idleTimeToLive: '5 minutes',
}) {}

export const initialPageIdentity: PageIdentity = { principalId: null, known: false, epoch: 0 }

export const identityFromPage = (page: PageDocument, epoch = 0): PageIdentity => ({
  principalId: page.principal?.id ?? null,
  known: page.principalKnown ?? true,
  epoch,
})

export const pageIdentityForNavigation = (identity: PageIdentity, url: URL): PageIdentity =>
  isPrivatePageUrl(url) || !identity.known || identity.principalId !== null
    ? { principalId: null, known: false, epoch: identity.epoch + 1 }
    : identity

export const acceptsPageIdentity = (identity: PageIdentity, page: PageDocument) =>
  !identity.known ||
  (page.principalKnown !== false && (page.principal?.id ?? null) === identity.principalId)

const failure = (
  reason: PageQueryError['reason'],
  status = 0,
  requestId: string | null = null,
  location: string | null = null,
) => new PageQueryError({ reason, status, requestId, location })

const guardPageIdentity = (
  page: PageDocument,
  identity: PageIdentity,
  status: number,
  requestId: string | null,
) =>
  acceptsPageIdentity(identity, page)
    ? Effect.succeed(page)
    : Effect.fail(failure('identity', status, requestId))

export const pageQueryArgs = (
  url: URL,
  identity: PageIdentity,
  realm: string,
): PageQueryArgs | undefined =>
  isPageUrl(url) ? { path: `${url.pathname}${url.search}`, identity, realm } : undefined

export const browserPageLayer = (origin: URL, realm: string, fetchPage: typeof fetch = fetch) =>
  GetPage.toLayer(({ path, identity, realm: requestedRealm }) =>
    Effect.gen(function* () {
      if (requestedRealm !== realm) return yield* Effect.fail(failure('identity'))

      const url = URL.parse(path, origin)

      if (url === null || url.origin !== origin.origin || !isPageUrl(url))
        return yield* Effect.fail(failure('origin'))

      const target = new URL(url)
      target.hash = ''
      target.searchParams.set('__data', '1')

      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetchPage(target, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { accept: 'application/json' },
            signal,
          }),
        catch: () => failure('transport'),
      })

      const requestId = response.headers.get('x-request-id')

      if (response.url && new URL(response.url).origin !== origin.origin)
        return yield* Effect.fail(failure('origin', response.status, requestId))

      if (!response.headers.get('content-type')?.includes('application/json'))
        return yield* Effect.fail(
          failure('redirect', response.status, requestId, response.url || null),
        )

      const input: unknown = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => failure('document', response.status, requestId),
      })

      const page = yield* Schema.decodeUnknownEffect(PageDocument)(input).pipe(
        Effect.mapError(() => failure('document', response.status, requestId)),
      )

      const owned = yield* guardPageIdentity(page, identity, response.status, requestId)

      if (response.status >= 500 || response.status === 429)
        return yield* Effect.fail(failure('transport', response.status, requestId))

      return owned
    }),
  )

type LoadedPage = Extract<Awaited<ReturnType<typeof loadPageData>>, { readonly redirect: null }>

export interface ServerPageOptions {
  readonly request: Request
  readonly ownedRequest: Request
  readonly requestId: string
  readonly realm: string
  readonly preloaded?: {
    readonly path: string
    readonly document: PageDocument
  }
  readonly load: typeof loadPageData
  readonly prepare: (page: LoadedPage) => Promise<PageDocument>
}

export const serverPageLayer = (options: ServerPageOptions) =>
  GetPage.toLayer(({ path, identity, realm }) =>
    Effect.gen(function* () {
      if (realm !== options.realm)
        return yield* Effect.fail(failure('identity', 0, options.requestId))

      const origin = new URL(options.ownedRequest.url)
      const url = URL.parse(path, origin)

      if (url === null || url.origin !== origin.origin || !isPageUrl(url))
        return yield* Effect.fail(failure('origin', 0, options.requestId))

      if (options.preloaded?.path === path) {
        const page = options.preloaded.document

        return yield* guardPageIdentity(page, identity, page.status, page.requestId)
      }

      const target = new URL(url)
      target.hash = ''
      target.searchParams.delete('__data')

      const page = yield* Effect.tryPromise({
        try: (signal) =>
          options.load(
            new Request(target, {
              headers: options.ownedRequest.headers,
              signal: AbortSignal.any([signal, options.ownedRequest.signal]),
            }),
            options.request,
            target,
            parseRoute(target.pathname),
            options.requestId,
          ),
        catch: () => failure('transport', 0, options.requestId),
      })

      if (page.redirect !== null)
        return yield* Effect.fail(failure('redirect', 302, options.requestId, page.redirect))

      const prepared = yield* Effect.tryPromise({
        try: () => options.prepare(page),
        catch: () => failure('document', page.flags.status, options.requestId),
      })

      return yield* guardPageIdentity(prepared, identity, prepared.status, prepared.requestId)
    }),
  )
