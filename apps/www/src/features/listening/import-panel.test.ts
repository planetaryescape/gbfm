import { Story } from '@effect/ui/testing'
import { expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { ImportPanel, ImportPanelMessage } from './import-panel'

const props = (url: string, available = false) => ({
  url,
  returnTo: '/listening',
  page: {
    document: { mixes: [], collections: [], memberships: [] },
    workspace: true,
    preview: available
      ? { items: [{ url: 'https://soundcloud.com/fixture/mix', title: 'Fixture' }], warnings: [] }
      : null,
    error: null,
  },
})

it.effect('preserves an explicitly opened capture panel when a workspace snapshot arrives', () =>
  Effect.gen(function* () {
    const input = props('https://fixture.test/listening')
    const story = yield* Story.make(ImportPanel, input)

    story
      .send(ImportPanelMessage.ToggledPanel({ open: true }))
      .props({ ...input, page: { ...input.page, error: 'Refresh notice' } })
      .send(ImportPanelMessage.ReceivedPreview({ available: false, url: input.url }))

    expect(story.model.open).toBe(true)
  }),
)

it.effect('does not reopen a dismissed preview for the same request or a stale request', () =>
  Effect.gen(function* () {
    const input = props('https://fixture.test/listening?import=first', true)
    const story = yield* Story.make(ImportPanel, input)

    story
      .send(ImportPanelMessage.ToggledPanel({ open: false }))
      .send(ImportPanelMessage.ReceivedPreview({ available: true, url: input.url }))
      .send(
        ImportPanelMessage.ReceivedPreview({
          available: true,
          url: 'https://fixture.test/listening?import=stale',
        }),
      )

    expect(story.model.open).toBe(false)
    expect(story.model.previewUrl).toBe(input.url)
  }),
)

it.effect('opens a newly requested preview after the previous one was dismissed', () =>
  Effect.gen(function* () {
    const input = props('https://fixture.test/listening?import=first', true)
    const next = props('https://fixture.test/listening?import=next', true)
    const story = yield* Story.make(ImportPanel, input)

    story
      .send(ImportPanelMessage.ToggledPanel({ open: false }))
      .props(next)
      .send(ImportPanelMessage.ReceivedPreview({ available: true, url: next.url }))

    expect(story.model.open).toBe(true)
    expect(story.model.previewUrl).toBe(next.url)
  }),
)
