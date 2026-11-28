import { UiSchema } from '@effect/ui'
import { BrowserHost, Html } from '@effect/ui/html'
import { Effect, Layer, Schema } from 'effect'

import { ListeningPage } from '../page'

const ListeningImportFixtureMessage = UiSchema.TaggedEnum({
  ClickedRefreshWorkspace: {},
  ClickedReceivePreview: {},
})

const ListeningImportFixtureModel = Schema.Struct({
  refreshed: Schema.Boolean,
  previewed: Schema.Boolean,
})

const ListeningImportFixture = Html.component({
  name: 'ListeningImportFixture',
  model: ListeningImportFixtureModel,
  message: ListeningImportFixtureMessage,
}).make({
  init: () => ({ refreshed: false, previewed: false }),
  update: {
    ClickedRefreshWorkspace: ($) => $.evolve({ refreshed: true }),
    ClickedReceivePreview: ($) => $.evolve({ previewed: true }),
  },
  view: (h, model) =>
    h.div.children(
      h.button
        .attr('type', 'button')
        .on('click', ListeningImportFixtureMessage.ClickedRefreshWorkspace())
        .children('Refresh workspace'),
      h.button
        .attr('type', 'button')
        .on('click', ListeningImportFixtureMessage.ClickedReceivePreview())
        .children('Receive import preview'),
      ListeningPage(h, {
        props: {
          document: {
            document: { mixes: [], collections: [], memberships: [] },
            workspace: true,
            preview: model.previewed
              ? {
                  items: [
                    { url: 'https://soundcloud.com/fixture/import-preview', title: 'Preview mix' },
                  ],
                  warnings: [],
                }
              : null,
            error: model.refreshed ? 'Workspace refreshed.' : null,
          },
          url: model.previewed
            ? 'http://fixture.test/listening?import=https%3A%2F%2Fsoundcloud.com%2Ffixture%2Fimport-preview'
            : 'http://fixture.test/listening',
          principal: {
            id: 'fixture-listener',
            name: 'Fixture Listener',
            username: 'fixture-listener',
            role: 'user',
          },
        },
      }),
    ),
})

const target = document.getElementById('app')

if (!target) throw new Error('Missing listening fixture target')

Layer.launch(BrowserHost.mount(ListeningImportFixture, {}, target)).pipe(Effect.runFork)
