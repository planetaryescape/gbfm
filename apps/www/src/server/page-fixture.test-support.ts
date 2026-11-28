import { makeStaticSiteMetadata } from '@gbfm/site-metadata'

import { PageDocument } from '../domain/page'
import { parseRoute } from '../route'
import type { LoadedPage } from './http-dispatch'

export const pageFixture = (path = '/about'): LoadedPage => {
  const url = new URL(path, 'https://preview.example.test')

  return {
    redirect: null,
    flags: PageDocument.make({
      url: url.href,
      status: 200,
      principal: null,
      principalKnown: true,
      items: [],
      title: 'Fixture page',
      description: 'Fixture description',
      requestId: 'prepared-fixture',
      renderedAt: 0,
      skipSeen: true,
      tweet: null,
      neighbours: null,
      dashboard: null,
      profile: null,
      shows: null,
      changelog: null,
      publicAction: null,
      metadata: makeStaticSiteMetadata('Fixture page', 'Fixture description', url.pathname),
      failure: null,
    }),
    identity: { principal: null, cookies: [] },
    response: null,
    neighbourResponse: null,
    tweetData: null,
    showDetailSlug: null,
    showMetadata: null,
    profile: null,
    route: parseRoute(url.pathname),
    url,
    requestId: 'prepared-fixture',
  }
}
