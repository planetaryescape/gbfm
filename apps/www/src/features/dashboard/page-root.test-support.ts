import { Effect } from 'effect'

import {
  acceptsPageIdentity,
  GetPage,
  PageQueryError,
  type PageQueryArgs,
} from '../../app/page-query'
import { AppBootstrap } from '../../app/routed-application'
import { documents, routedLayer } from '../../app/routed-feature-lifetime.test-support'
import { PageDocument } from '../../domain/page'
import type { Principal } from '../../domain/principal'
import { pageFixture } from '../../server/page-fixture.test-support'
import type { DashboardDocument } from './document'

export interface DashboardPageActor {
  readonly principal: Principal | null
  readonly principalKnown: boolean | undefined
  readonly status: number
  readonly failure: string | null
  readonly dashboard: DashboardDocument | null
}

export const verifiedActor: DashboardPageActor = {
  principal: { id: 'owner-a', name: 'Fixture owner', username: 'fixture-owner', role: 'user' },
  principalKnown: true,
  status: 200,
  failure: null,
  dashboard: null,
}

export const dashboardRootFixture = (path: string, initial: DashboardPageActor = verifiedActor) => {
  let actor = initial
  const base = documents(path)
  const requests: Array<PageQueryArgs> = []
  const apiRequests: Array<string> = []

  const props = AppBootstrap.make({
    ...base.props,
    identity: {
      principalId: actor.principal?.id ?? null,
      known: actor.principalKnown === true,
      epoch: 0,
    },
  })

  const pages = GetPage.toLayer((args) =>
    Effect.gen(function* () {
      requests.push(args)

      const page = PageDocument.make({
        ...pageFixture(args.path).flags,
        url: new URL(args.path, props.url).href,
        ...actor,
      })

      if (!acceptsPageIdentity(args.identity, page))
        return yield* new PageQueryError({
          reason: 'identity',
          status: page.status,
          requestId: page.requestId,
          location: null,
        })

      return page
    }),
  )

  const fetch: typeof globalThis.fetch = async (input, init) => {
    apiRequests.push(new Request(input, init).url)
    throw new Error('Unexpected dashboard HTTP request in a documentless page fixture')
  }

  return {
    props,
    requests,
    apiRequests,
    layer: routedLayer({ ...base, props, layer: pages }, fetch),
    principalActor: (next: DashboardPageActor) => {
      actor = next
    },
  }
}
