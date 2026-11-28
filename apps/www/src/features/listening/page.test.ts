import { HtmlServer } from '@effect/ui/html'
import { Story } from '@effect/ui/testing'
import { it, expect } from '@effect/vitest'
import { Effect } from 'effect'

import type { ListeningPage as ListeningDocument } from '../../domain/listening'
import { MixEditor, MixEditorMessage } from './editor'
import { ListeningPage } from './page'

const document: ListeningDocument = {
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
}

it('native listening forms keep target-specific versions and POST fallback contracts', () =>
  Effect.gen(function* () {
    const { html } = yield* HtmlServer.renderToHtml(ListeningPage, {
      document,
      url: 'https://fixture.test/listening?collection=collection-a&mix=mix-a',
      principal: { id: 'owner', name: 'Owner', username: 'owner', role: 'user' },
    })

    for (const [operation, version] of [
      ['edit-mix', 'revision:7'],
      ['delete-mix', 'revision:7'],
      ['membership', 'revision:19'],
      ['edit-collection', 'revision:19'],
      ['delete-collection', 'revision:19'],
    ]) {
      const form = html.match(
        new RegExp(`<form[^>]*action="/actions/listening/${operation}"[^>]*>([\\s\\S]*?)</form>`),
      )?.[1]

      expect(form).toBeDefined()
      expect(form).toContain('name="expectedVersion"')
      expect(form).toContain(`value="${version}"`)
    }

    expect(html).toContain('action="/actions/listening/bulk-links"')
    expect(html).toContain('action="/actions/listening/create-collection"')
  }).pipe(Effect.scoped, Effect.runPromise))

it('editing a draft preserves its observed version and ignores an invalid select value', () =>
  Effect.gen(function* () {
    const mix = document.document.mixes[0]

    if (!mix) throw new Error('Missing fixture mix')

    const s = yield* Story.make(MixEditor, {
      initialMix: mix,
      page: document,
      returnTo: '/listening',
      queueHref: '/listening',
    })

    s.send(MixEditorMessage.UpdatedTitle({ value: 'Changed title' }))
      .send(MixEditorMessage.UpdatedNotes({ value: 'Private draft notes' }))
      .send(MixEditorMessage.UpdatedStatus({ value: 'invalid' }))
      .send(MixEditorMessage.ToggledPublished())
    expect(s.model).toMatchObject({
      title: 'Changed title',
      notes: 'Private draft notes',
      status: 'listening',
      version: 'revision:7',
      published: true,
    })
  }).pipe(Effect.scoped, Effect.runPromise))
