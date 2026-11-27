import { Html, HtmlServer } from '@effect/ui/html'
import { Story } from '@effect/ui/testing'
import { Effect, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { PlayerMessage, PlayerProvider, playerServerLayer } from '../player/provider'
import { runWithLayer } from '../player/testing'
import { MediaPreviewBoundary, MediaPreviewEvents, MediaPreviewMessage } from './mount'

describe('native private media boundary', () => {
  it('closes playback overlays and reports denial without replacing playback ownership', () =>
    Effect.runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const s = yield* Story.make(MediaPreviewBoundary, {})
          s.send(MediaPreviewMessage.DeniedPreview())
            .sent(PlayerProvider, PlayerMessage.RequestedCloseOverlays())
            .emitted(MediaPreviewEvents.Denied())
          expect(s.model.denied).toBe(true)
          s.send(MediaPreviewMessage.DismissedNotice())
          expect(s.model.denied).toBe(false)
        }),
      ),
    ))

  it('renders slotted public content on the server without executing browser observers or grants', async () => {
    const Page = Html.component({
      name: 'MediaPreviewServerPage',
      model: Schema.Null,
      message: Schema.Never,
    }).make({
      init: () => null,
      update: ($) => $.model,
      view: (h) =>
        PlayerProvider(h, {
          props: { principalId: null, principalKnown: true, returnTo: '/' },
          view: () =>
            MediaPreviewBoundary(h, {
              slots: { content: h.main.children(h.h1('Public music page')) },
            }),
        }),
    })

    const result = await runWithLayer(playerServerLayer, HtmlServer.renderToHtml(Page, {}))

    expect(result.html).toContain('Public music page')
    expect(result.state['~deferred']).toEqual([])
    expect(JSON.stringify(result.state)).not.toContain('grant')
  })
})
