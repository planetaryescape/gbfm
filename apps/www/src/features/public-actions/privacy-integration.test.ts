import { UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { Effect, Layer, Schema } from 'effect'
import { expect, it } from 'vitest'

import { MembershipButton } from './button'
import { type MembershipModel, MembershipProps } from './domain'
import {
  controlsContext,
  document,
  membershipAdapter,
  receipt,
  runWithLayer,
} from './integration.test-support'
import { MembershipProvider } from './provider'

it.each([true, false])(
  'every native reader render masks account A on changed props before the model catches up, known: %s',
  async (known) => {
    const frames: Array<{ expected: string | null; shared: MembershipModel }> = []
    const pending = Promise.withResolvers<Response>()
    let reads = 0

    const adapter = membershipAdapter(
      async () => receipt(),
      async () => {
        reads += 1

        return reads === 1
          ? Response.json({ revision: 17, favorited: true, subscribed: false })
          : pending.promise
      },
    )

    const Probe = Html.component({
      name: 'MembershipPrivacyProbe',
      props: MembershipProps,
      model: Schema.Null,
      message: Schema.Never,
      reads: { provider: MembershipProvider },
    }).make({
      init: () => null,
      update: ($) => $.model,
      view: (h) => {
        frames.push({ expected: h.props.principalId, shared: h.reads.provider })

        return h.text('')
      },
    })

    const Message = UiSchema.TaggedEnum({ ChangedContext: { context: MembershipProps } })

    const Fixture = Html.component({
      name: 'MembershipPrivacyFixture',
      model: MembershipProps,
      message: Message,
    }).make({
      init: () => controlsContext,
      update: { ChangedContext: ($, { context }) => $.set(context) },
      view: (h, model) =>
        MembershipProvider(h, {
          props: model,
          view: () =>
            h.div.children(
              MembershipButton(h, { props: { document: document(undefined, 'active') } }),
              Probe(h, { props: model }),
            ),
        }),
    })

    await runWithLayer(
      Effect.gen(function* () {
        const root = yield* TestHost.mount(Fixture, {})
        yield* TestHost.settle
        expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(1)
        root.send(
          Message.ChangedContext({ context: { principalId: 'account-b', principalKnown: known } }),
        )
        yield* TestHost.settle
        const transitioned = frames.filter((frame) => frame.expected === 'account-b')
        expect(transitioned.length).toBeGreaterThanOrEqual(2)
        expect(transitioned[0]?.shared).toMatchObject({
          principalId: null,
          principalKnown: false,
          entries: {},
          revision: null,
        })
        expect(transitioned.every((frame) => frame.shared.principalId !== 'account-a')).toBe(true)
        expect(
          transitioned.every((frame) => frame.shared.entries['audio:audio-a']?.status !== 'active'),
        ).toBe(true)
        expect(root.all(Locator.attr('aria-label', 'Remove from favorites'))).toHaveLength(0)
        expect(reads).toBe(known ? 2 : 1)
        pending.resolve(Response.json({ revision: 27, favorited: false, subscribed: false }))
        yield* TestHost.settle
        expect(frames.at(-1)?.shared).toMatchObject({
          principalId: 'account-b',
          principalKnown: known,
          entries: {
            'audio:audio-a': {
              status: known ? 'inactive' : 'unavailable',
              revision: known ? 27 : null,
            },
          },
        })
        expect(root.all(Locator.attr('aria-label', 'Add to favorites'))).toHaveLength(known ? 1 : 0)
      }),
      Layer.merge(TestHost.layer(), adapter.layer),
    )
  },
)
