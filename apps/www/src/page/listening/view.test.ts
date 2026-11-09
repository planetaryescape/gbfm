import { Effect } from 'effect'
import * as Server from 'foldkit/experimental/server'
import { expect, test } from 'vitest'

import { applicationConfig } from '../../config'
import type { Flags } from '../../model'

test('owner forms render their own observed tokens, not another target’s version', async () => {
  const flags: Flags = {
    url: 'https://fixture.test/listening?collection=collection-a&mix=mix-a',
    status: 200,
    principal: { id: 'owner', name: 'Owner', username: 'owner', role: 'user' },
    items: [],
    title: 'Listening',
    description: '',
    requestId: 'listening-form-fixture',
    renderedAt: 0,
    skipSeen: false,
    tweet: null,
    neighbours: null,
    dashboard: null,
    profile: null,
    shows: null,
    changelog: null,
    publicAction: null,
    metadata: null,
    failure: null,
    listening: {
      workspace: true,
      error: null,
      preview: null,
      document: {
        mixes: [
          {
            id: 'mix-a',
            url: 'https://soundcloud.com/fixture/mix',
            platform: 'soundcloud',
            embedUrl: null,
            title: 'Fixture mix',
            notes: 'Notes',
            status: 'listening',
            published: false,
            version: 'revision:7',
          },
        ],
        collections: [
          {
            id: 'collection-a',
            title: 'Collection A',
            description: '',
            published: false,
            ownerName: 'Owner',
            version: 'revision:19',
          },
        ],
        memberships: [{ collectionId: 'collection-a', mixId: 'mix-a' }],
      },
    },
  }

  const rendered = await Effect.runPromise(
    Server.renderToString(applicationConfig, {
      flags,
      url: flags.url,
      buildId: 'listening-fixture',
    }),
  )

  for (const [operation, version] of [
    ['edit-mix', 'revision:7'],
    ['delete-mix', 'revision:7'],
    ['membership', 'revision:19'],
    ['edit-collection', 'revision:19'],
    ['delete-collection', 'revision:19'],
  ]) {
    const form = rendered.html.match(
      new RegExp(`<form[^>]*action="/actions/listening/${operation}"[^>]*>([\\s\\S]*?)</form>`),
    )?.[1]

    expect(form).toBeDefined()
    expect(form).toContain('name="expectedVersion"')
    expect(form).toContain(`value="${version}"`)
  }
})
