import { describe, expect, it } from 'vitest'

import { parseRoute, Route } from './route'

describe('parseRoute', () => {
  it('parses public, creator, dashboard, and missing routes', () => {
    expect(parseRoute('/mixes/42')).toEqual(Route.cases.Detail.make({ kind: 'mixes', slug: '42' }))
    expect(parseRoute('/new/editorial')).toEqual(Route.cases.Composer.make({ kind: 'editorial' }))
    expect(parseRoute('/dashboard/email-logs')).toEqual(
      Route.cases.Dashboard.make({
        section: 'email-logs',
      }),
    )
    expect(parseRoute('/local-creator')).toEqual(
      Route.cases.Detail.make({ kind: 'resolve', slug: 'local-creator' }),
    )
    expect(parseRoute('/definitely/missing/route')).toEqual(Route.cases.NotFound.make({}))
  })
})
