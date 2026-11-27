import { Html } from '@effect/ui/html'
import { Locator, TestHost } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'

import { accountMenu } from './account-menu'
import { NavigationMessage } from './domain'

const AccountAnchorRoot = Html.component({
  name: 'AccountAnchorRoot',
  model: Schema.Number,
  message: NavigationMessage,
}).make({
  init: () => 0,
  update: ($) => $.model + 1,
  view: (h) =>
    h.div.children(
      h.button
        .attr('aria-label', 'Refresh parent')
        .on('click', NavigationMessage.Ready())
        .children('Refresh'),
      accountMenu(
        h,
        {
          id: 'listener',
          name: 'Listener',
          username: 'listener',
          image: null,
          role: null,
        },
        false,
        true,
      ),
    ),
})

it.layer(TestHost.layer(), { buildPerTest: true })('account anchor', (it) => {
  it.effect(
    'renders one caller-owned account trigger and matching portal across parent renders',
    () =>
      Effect.gen(function* () {
        const root = yield* TestHost.mount(AccountAnchorRoot, {})
        yield* TestHost.settle
        const trigger = Locator.attr('aria-label', 'Account menu')
        const id = root.get(trigger).attrs?.id
        assert.strictEqual(id, 'station-account-trigger')
        const portalId = root.get(trigger).attrs?.['data-dialog-trigger']
        assert.isString(portalId)
        assert.lengthOf(root.all(Locator.attr('id', portalId)), 1)

        for (let index = 0; index < 3; index++) {
          Locator.fire(root.get(Locator.attr('aria-label', 'Refresh parent')), 'click')
          yield* TestHost.settle
          assert.strictEqual(root.get(trigger).attrs?.id, id)
          assert.lengthOf(root.all(trigger), 1)
        }
      }),
  )
})
