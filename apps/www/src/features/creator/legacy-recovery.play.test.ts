import { Component } from '@effect/ui'
import { HtmlLocator, HtmlPlay } from '@effect/ui/html/testing'
import { Locator, TestHost } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import { Effect, Layer, Schema, Stream } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'

import { CreatorPageNoDeps, creatorRuntimeLayer } from './CreatorPage'
import { emptyDraft } from './domain'
import { CreatorLegacyRecovery, makeLegacyRecovery } from './legacy-recovery'
import { CreatorDraftSchema, CreatorService, CreatorServiceLive } from './services'
import { CreatorUpload } from './upload/runtime'

const principal = {
  id: 'synthetic-guidefari',
  name: 'Synthetic account',
  username: 'guidefari',
  role: 'admin',
}

const legacyKey = 'gbfm:creator:micro:new'

const scopedKey = `gbfm:creator:${principal.id}:micro:new`

const original = JSON.stringify({
  ...emptyDraft('micro', principal.id),
  title: 'Existing legacy writing',
})

const client = HttpClient.make((request) =>
  Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 404 }))),
).pipe(HttpClient.mapRequest(HttpClientRequest.prependUrl('https://gbfm.test')))

const fixture = () => {
  const values = new Map([[legacyKey, original]])

  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }

  const service = Layer.effect(
    CreatorService,
    Effect.map(CreatorService, (base) => ({
      ...base,
      readLocalDraft: (key: string) =>
        Effect.suspend(() => {
          const raw = storage.getItem(`gbfm:creator:${key}`)

          return raw === null
            ? Effect.succeed(null)
            : Schema.decodeUnknownEffect(Schema.fromJsonString(CreatorDraftSchema))(raw).pipe(
                Effect.orDie,
              )
        }),
      writeLocalDraft: (key, draft) =>
        Effect.sync(() => storage.setItem(`gbfm:creator:${key}`, JSON.stringify(draft))),
    })),
  ).pipe(Layer.provide(CreatorServiceLive))

  const upload = Layer.succeed(CreatorUpload, {
    start: () => Effect.succeed('unused'),
    resume: Effect.succeed('unused'),
    pause: Effect.void,
    cancel: Effect.void,
    progress: Stream.empty,
  })

  const component = CreatorPageNoDeps.pipe(
    Component.provide(
      creatorRuntimeLayer.pipe(
        Layer.provide(Layer.succeed(CreatorLegacyRecovery, makeLegacyRecovery(storage))),
        Layer.provide(service),
        Layer.provideMerge(upload),
      ),
    ),
  )

  return { component, values, storage }
}

it.layer(Layer.mergeAll(TestHost.layer(), Layer.succeed(HttpClient.HttpClient, client)), {
  buildPerTest: true,
})('guidefari recovery through the native runtime', (it) => {
  for (const action of ['restore', 'dismiss'] satisfies ReadonlyArray<'restore' | 'dismiss'>) {
    it.effect(`requires explicit ${action} and never reoffers handled legacy content`, () =>
      Effect.gen(function* () {
        const { component, storage, values } = fixture()
        const play = yield* HtmlPlay.make(component, { url: '/new/tweet', principal })

        yield* play.expect(Locator.text('Recover unsaved writing?')).toExist()
        yield* play.expect(HtmlLocator.role('textbox', { name: 'Title' })).toHaveValue('')
        assert.equal(storage.getItem(scopedKey), null)
        yield* play.click(
          HtmlLocator.role('button', {
            name: action === 'restore' ? 'Recover draft' : 'Keep saved version',
          }),
        )
        yield* play.expect(Locator.text('Recover unsaved writing?')).toBeAbsent()
        yield* play
          .expect(HtmlLocator.role('textbox', { name: 'Title' }))
          .toHaveValue(action === 'restore' ? 'Existing legacy writing' : '')
        assert.equal(storage.getItem(legacyKey), original)
        values.delete(scopedKey)
        const reloaded = yield* HtmlPlay.make(component, { url: '/new/tweet', principal })

        yield* reloaded.expect(Locator.text('Recover unsaved writing?')).toBeAbsent()
        yield* reloaded.expect(Locator.text('Existing legacy writing')).toBeAbsent()
        assert.equal(storage.getItem(legacyKey), original)
      }),
    )
  }

  it.effect('does not show the guidefari legacy preview to another or unknown account', () =>
    Effect.gen(function* () {
      for (const username of ['other-account', null]) {
        const { component, storage } = fixture()

        const play = yield* HtmlPlay.make(component, {
          url: '/new/tweet',
          principal: { ...principal, id: 'account-b', username },
        })

        yield* play.expect(Locator.text('Recover unsaved writing?')).toBeAbsent()
        yield* play.expect(Locator.text('Existing legacy writing')).toBeAbsent()
        yield* play.expect(HtmlLocator.role('textbox', { name: 'Title' })).toHaveValue('')
        assert.equal(storage.getItem(legacyKey), original)
        assert.equal(storage.getItem('gbfm:creator:account-b:micro:new'), null)
      }
    }),
  )
})
