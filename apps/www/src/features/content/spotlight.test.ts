import { Component } from '@effect/ui'
import { HtmlServer } from '@effect/ui/html'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import { RichContentDocument } from '@gbfm/rich-content/schema'
import { parseRichContent } from '@gbfm/rich-content/source'
import { Effect, Schema } from 'effect'

import { ContentDetailPageMessage, ContentDetailPageNoDeps, SaveSpotlightProgress } from './detail'
import { publicMix, publicPage, PublicContentTestRoot } from './fixtures'

const parsed = Schema.decodeUnknownSync(RichContentDocument)(
  parseRichContent('Intro.\n\n## Chapter\n\n### Record\n\nA thought.').document,
)

const richContent = RichContentDocument.make({ ...parsed, layout: 'spotlight' })

const item = { ...publicMix, richContent }

const url = 'https://goosebumps.fm/editorial/night-mix'

for (const at of ['', '2.3', 'garbage', '0', '1.999', null]) {
  it.effect(`starts invalid spotlight URL position ${JSON.stringify(at)} at the intro`, () =>
    Effect.gen(function* () {
      const location = new URL(url)

      if (at !== null) location.searchParams.set('at', at)

      const s = yield* HtmlScene.make(
        ContentDetailPageNoDeps,
        { item, kind: 'editorial', url: location.href },
        { slots: (h) => ({ actions: h.text('') }) },
      )

      if (at !== null) {
        s.subscription(
          'RestoreSpotlight:"/editorial/night-mix"',
          ContentDetailPageMessage.RestoredSpotlight({
            progress: { path: '/editorial/night-mix', at: '1.1', seen: ['1.1'] },
          }),
        )
      }

      s.expect(Locator.text('Night Mix')).toExist()
      s.click('Start').expectExact(SaveSpotlightProgress)
      assert.deepStrictEqual(s.pending[0]?.command.args, {
        progress: { path: '/editorial/night-mix', at: '1', seen: ['1'] },
      })
      s.resolve(SaveSpotlightProgress, Component.noop)
    }),
  )
}

for (const [at, next] of [
  ['1', '1.1'],
  ['1.1', 'end'],
  ['end', 'end'],
]) {
  it.effect(`preserves valid spotlight URL position ${at} over stored progress`, () =>
    Effect.gen(function* () {
      const s = yield* HtmlScene.make(
        ContentDetailPageNoDeps,
        { item, kind: 'editorial', url: `${url}?at=${at}` },
        { slots: (h) => ({ actions: h.text('') }) },
      )

      s.subscription(
        'RestoreSpotlight:"/editorial/night-mix"',
        ContentDetailPageMessage.RestoredSpotlight({
          progress: { path: '/editorial/night-mix', at: null, seen: ['intro'] },
        }),
      )
      s.subscription(
        'SpotlightKeyboard:',
        ContentDetailPageMessage.RequestedNextEntry(),
      ).expectExact(SaveSpotlightProgress)
      assert.deepStrictEqual(s.pending[0]?.command.args, {
        progress: { path: '/editorial/night-mix', at: next, seen: [next] },
      })
      s.resolve(SaveSpotlightProgress, Component.noop)
    }),
  )
}

it.effect(
  'normalizes restored spotlight progress idempotently before persisting the next step',
  () =>
    Effect.gen(function* () {
      const s = yield* HtmlScene.make(
        ContentDetailPageNoDeps,
        { item, kind: 'editorial', url },
        { slots: (h) => ({ actions: h.text('') }) },
      )

      const progress = {
        path: '/editorial/night-mix',
        at: '2.3',
        seen: ['intro', '1', '1.1', '2.3'],
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        s.subscription(
          'RestoreSpotlight:"/editorial/night-mix"',
          ContentDetailPageMessage.RestoredSpotlight({ progress }),
        )
      }

      s.expect(Locator.text('Night Mix')).toExist()
      s.click('Start').expectExact(SaveSpotlightProgress)
      assert.deepStrictEqual(s.pending[0]?.command.args, {
        progress: { path: '/editorial/night-mix', at: '1', seen: ['intro', '1', '1.1'] },
      })
      s.resolve(SaveSpotlightProgress, Component.noop)
    }),
)

it.effect('keeps a complete no-JavaScript editorial alongside the native stepped reader', () =>
  Effect.gen(function* () {
    const result = yield* HtmlServer.renderToHtml(PublicContentTestRoot, {
      document: publicPage('/editorial/night-mix', [item]),
    })

    assert.include(result.html, 'spotlight')
    assert.include(result.html, '<noscript>')
    assert.include(result.html, 'A thought.')
    assert.include(result.html, 'Night Mix')
  }),
)

it.effect(
  'owns progress locally, persists real positions and rejects a late stored-progress restore',
  () =>
    Effect.gen(function* () {
      const s = yield* HtmlScene.make(
        ContentDetailPageNoDeps,
        { item, kind: 'editorial', url },
        {
          slots: (h) => ({ actions: h.text('') }),
        },
      )

      s.click('Start')
        .expectExact(SaveSpotlightProgress)
        .resolve(SaveSpotlightProgress, Component.noop)
        .click(HtmlLocator.role('button', { name: 'Record' }))
        .expectExact(SaveSpotlightProgress)
      assert.deepStrictEqual(s.pending[0]?.command.args, {
        progress: { path: '/editorial/night-mix', at: '1.1', seen: ['1', '1.1'] },
      })
      s.resolve(SaveSpotlightProgress, Component.noop).subscription(
        'RestoreSpotlight:"/editorial/night-mix"',
        ContentDetailPageMessage.RestoredSpotlight({
          progress: { path: '/editorial/night-mix', at: '1', seen: ['1'] },
        }),
      )
      s.subscription(
        'SpotlightKeyboard:',
        ContentDetailPageMessage.RequestedNextEntry(),
      ).expectExact(SaveSpotlightProgress)
      assert.deepStrictEqual(s.pending[0]?.command.args, {
        progress: { path: '/editorial/night-mix', at: 'end', seen: ['1', '1.1', 'end'] },
      })
      s.resolve(SaveSpotlightProgress, Component.noop)
    }),
)
