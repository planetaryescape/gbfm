import { HtmlServer } from '@effect/ui/html'
import { Effect } from 'effect'

import { type EntryResult, Rendered, Responded } from '../../src/server/effect-ui'
import { FixtureApp, FixtureIdentity } from './App'

export { renderDocument } from '../../src/server/effect-ui/document'

export const renderPage = async (request: Request): Promise<EntryResult> => {
  const url = new URL(request.url)

  if (url.pathname === '/redirect')
    return Responded(new Response(null, { status: 303, headers: { location: '/' } }))

  if (url.searchParams.has('__data')) return Responded(Response.json({ title: 'Native fixture' }))
  const label = request.headers.get('x-fixture-identity') ?? 'Anonymous'
  let reads = 0
  const props = { title: 'Native fixture' }

  const rendered = await Effect.runPromise(
    HtmlServer.renderToHtml(FixtureApp, props, { budget: '2 seconds' }).pipe(
      Effect.provideService(FixtureIdentity, {
        read: Effect.sync(() => {
          reads += 1

          return label
        }),
      }),
    ),
  )

  const headers = new Headers({
    'cache-control': 'private, no-store',
    'x-fixture-query-count': String(reads),
  })

  headers.append('set-cookie', 'fixture-first=1; HttpOnly; Path=/')
  headers.append('set-cookie', 'fixture-second=2; HttpOnly; Path=/')

  return Rendered(
    {
      ...rendered,
      serializedProps: HtmlServer.serializeState(props),
      extraHead: '<meta name="robots" content="noindex, nofollow">',
    },
    {
      status: url.pathname === '/missing' ? 404 : 200,
      headers,
    },
  )
}
