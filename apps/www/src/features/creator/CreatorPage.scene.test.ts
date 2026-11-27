import { Dialog, DialogEvents } from '@effect/ui-kit'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { assert, it } from '@effect/vitest'
import type { RichContentBlock, RichContentDocument } from '@gbfm/rich-content/schema'
import { Data, Effect } from 'effect'

import { CreatorPageNoDeps } from './CreatorPage'
import { emptyDraft } from './domain'
import {
  AttachMarkdownEditor,
  FocusAttachmentInput,
  FocusAttachmentTool,
  WarnBeforeLeave,
} from './editor'
import { ReconcileDraft, ResolveQuote, SaveContent } from './operations'
import { CreatorPageMessage as M } from './state'

const principal = { id: 'author-a', name: 'Author', username: 'author', role: 'admin' }

const Block = Data.taggedEnum<RichContentBlock>()

it.effect(
  'announces a review error once and moves its alert back to composition on dismissal',
  () =>
    Effect.gen(function* () {
      const s = yield* HtmlScene.make(CreatorPageNoDeps, { url: '/new/tweet', principal })
      s.expectMount(WarnBeforeLeave({ dirty: false }))
        .expectMount(AttachMarkdownEditor({ content: '', focus: false }))
        .given((model) => ({ ...model, review: true, error: 'No usable images found' }))
        .expectMount(WarnBeforeLeave({ dirty: false }))
        .expectMount(AttachMarkdownEditor({ content: '', focus: false }))
        .expect(HtmlLocator.role('alert', { hidden: true }))
        .toHaveText('No usable images found')
        .childEmit(Dialog, 'publish', DialogEvents.RequestedClose({ reason: 'escape-key' }))
        .expect(HtmlLocator.role('alert'))
        .toHaveText('No usable images found')
    }),
)

it.effect('passes the exact authorized saved body to the first editor mount before editing', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(CreatorPageNoDeps, {
      url: '/new/editorial?edit=saved',
      principal,
    })

    const draft = {
      ...emptyDraft('post', principal.id, 'saved'),
      title: 'Original editorial',
      content: 'Original body',
      postId: 'post-a',
      draft: true,
      creators: [],
    }

    s.loaded('editable', draft)
      .expectMount(WarnBeforeLeave({ dirty: false }))
      .expectMount(AttachMarkdownEditor({ content: 'Original body', focus: false }))
      .loaded('diagnostics', [])
      .expect(HtmlLocator.role('textbox', { name: 'Title' }))
      .toHaveValue('Original editorial')
  }),
)

it.effect('keeps the quote label beside the resolved title in composition and review', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(CreatorPageNoDeps, { url: '/new/tweet', principal })
    s.expectMount(WarnBeforeLeave({ dirty: false }))
      .expectMount(AttachMarkdownEditor({ content: '', focus: false }))
      .type(HtmlLocator.role('textbox', { name: 'Title' }), 'A quoted signal')
      .expectMount(WarnBeforeLeave({ dirty: true }))
      .click(
        Locator.inside(
          HtmlLocator.role('group', { name: 'Add to your tweet' }),
          HtmlLocator.role('button', { name: /^Quote$/ }),
        ),
      )
      .expectMount(FocusAttachmentInput())
      .type(HtmlLocator.role('textbox', { name: 'Quote a tweet' }), '/tweet/saved')
      .click(HtmlLocator.role('button', { name: 'Attach quote' }))
      .resolve(
        ResolveQuote,
        M.SucceededResolveQuote({ revision: 2, id: 'quoted-a', title: 'Saved signal' }),
      )
      .expectMount(FocusAttachmentTool())
      .expect(Locator.text('Quoted tweet'))
      .toExist()
      .click(HtmlLocator.role('button', { name: 'Continue' }))
      .expect(
        Locator.inside(
          HtmlLocator.role('dialog', { name: 'Publish post', hidden: true }),
          Locator.text('Quoted tweet'),
        ),
      )
      .toExist()
  }),
)

it.effect('renders the native attached music card in review independently of body content', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(CreatorPageNoDeps, {
      url: '/new/tweet?edit=saved',
      principal,
    })

    const document: RichContentDocument = {
      version: 1,
      blocks: [
        Block.MusicEmbed({
          music: {
            entityType: 'track',
            entityId: 'track-a',
            title: 'Native attached track',
            artists: ['Fixture artist'],
            description: null,
            imageUrl: null,
            canonicalUrl: '/music/track/track-a',
            links: [],
            tracks: [],
          },
          genres: [],
          blurb: null,
          showTracks: false,
        }),
      ],
    }

    s.loaded('editable', {
      ...emptyDraft('micro', principal.id, 'saved'),
      title: 'Listening now',
      content: '',
      postId: 'post-a',
      draft: true,
      musicEntityType: 'track',
      musicEntityId: 'track-a',
      creators: [],
    })
      .expectMount(WarnBeforeLeave({ dirty: false }))
      .expectMount(AttachMarkdownEditor({ content: '', focus: false }))
      .loaded('attachmentPreview', document)
      .loaded(
        'references',
        { entityType: 'track', entityId: 'track-a', offset: 0, attempt: 0 },
        { data: [], pagination: { hasMore: false } },
      )
      .click(HtmlLocator.role('button', { name: 'Continue' }))
      .expect(
        Locator.inside(
          HtmlLocator.role('dialog', { name: 'Publish post', hidden: true }),
          Locator.text('Native attached track'),
        ),
      )
      .toExist()
  }),
)

it.effect('opens the saved edit route after saving from a new-editor URL', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(CreatorPageNoDeps, { url: '/new/editorial', principal })

    s.expectMount(WarnBeforeLeave({ dirty: false }))
      .expectMount(AttachMarkdownEditor({ content: '', focus: false }))
      .type(HtmlLocator.role('textbox', { name: 'Title' }), 'A new saved editorial')
      .expectMount(WarnBeforeLeave({ dirty: true }))
      .click(HtmlLocator.role('button', { name: 'Save draft' }))
      .resolve(
        SaveContent,
        M.SucceededSaveContent({
          operation: 1,
          revision: 1,
          publish: false,
          draft: { ...emptyDraft('post', principal.id), title: 'A new saved editorial' },
          saved: { id: 'post-a', slug: 'saved-editorial', updatedAt: '2026-11-27T12:00:00.000Z' },
        }),
      )
      .expectMount(WarnBeforeLeave({ dirty: false }))
      .resolve(ReconcileDraft, M.CompletedReconcileDraft({ operation: 1 }))
      .expect(HtmlLocator.role('link', { name: 'Open latest saved version (new tab)' }))
      .toHaveAttribute('href', '/new/editorial?edit=saved-editorial')
      .expect(HtmlLocator.role('link', { name: 'Open latest saved version (new tab)' }))
      .toHaveAttribute('target', '_blank')
  }),
)

it.effect('consumes attachment Enter without letting its native form submit a remote draft', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(CreatorPageNoDeps, { url: '/new/tweet', principal })

    s.expectMount(WarnBeforeLeave({ dirty: false }))
      .expectMount(AttachMarkdownEditor({ content: '', focus: false }))
      .type(HtmlLocator.role('textbox', { name: 'Title' }), 'Keep this private locally')
      .expectMount(WarnBeforeLeave({ dirty: true }))
      .click(HtmlLocator.role('button', { name: 'Media' }))
      .expectMount(FocusAttachmentInput())
      .type(HtmlLocator.role('textbox', { name: 'Embed media' }), 'https://bandcamp.com')
      .keydown(HtmlLocator.role('textbox', { name: 'Embed media' }), 'Enter')
      .expectExact()

    assert.isTrue(s.defaultPrevented)
    s.expect(Locator.text('Unsaved changes'))
      .toExist()
      .expect(Locator.text('Draft saved privately.'))
      .toBeAbsent()
  }),
)

it.effect('marks excessive tweet text invalid and blocks continuing until it is trimmed', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(CreatorPageNoDeps, { url: '/new/tweet', principal })

    s.expectMount(WarnBeforeLeave({ dirty: false }))
      .expectMount(AttachMarkdownEditor({ content: '', focus: false }))
      .type(HtmlLocator.role('textbox', { name: 'Title' }), 'a'.repeat(256))
      .expectMount(WarnBeforeLeave({ dirty: true }))
      .expect(HtmlLocator.role('textbox', { name: 'Title' }))
      .toHaveAttribute('aria-invalid', 'true')
      .expect(HtmlLocator.role('button', { name: 'Continue' }))
      .toBeDisabled()
      .type(HtmlLocator.role('textbox', { name: 'Title' }), 'a'.repeat(255))
      .expect(HtmlLocator.role('button', { name: 'Continue' }))
      .toBeDisabled(false)
  }),
)

it.effect('offers all native authoring entry points and opens the tweet editor', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(CreatorPageNoDeps, { url: '/new', principal })

    s.expect(HtmlLocator.role('link', { name: 'Tweet' }))
      .toExist()
      .expect(HtmlLocator.role('link', { name: 'Editorial' }))
      .toExist()
      .expect(HtmlLocator.role('link', { name: 'Mix' }))
      .toExist()
      .click(HtmlLocator.role('link', { name: 'Tweet' }))
      .expectMount(WarnBeforeLeave({ dirty: false }))
      .expectMount(AttachMarkdownEditor({ content: '', focus: false }))
      .expect(HtmlLocator.role('textbox', { name: 'Title' }))
      .toHaveValue('')
      .expect(HtmlLocator.role('button', { name: 'Save draft' }))
      .toExist()
  }),
)

it.effect('saves through the native form and reflects the saved identity', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(CreatorPageNoDeps, { url: '/new/tweet', principal })

    s.expectMount(WarnBeforeLeave({ dirty: false }))
      .expectMount(AttachMarkdownEditor({ content: '', focus: false }))
      .type(HtmlLocator.role('textbox', { name: 'Title' }), 'An authored tweet')
      .expectMount(WarnBeforeLeave({ dirty: true }))
      .click(HtmlLocator.role('button', { name: 'Save draft' }))
      .expectExact(SaveContent)

    s.resolve(
      SaveContent,
      M.SucceededSaveContent({
        operation: 1,
        revision: 1,
        publish: false,
        draft: { ...emptyDraft('micro', principal.id), title: 'An authored tweet' },
        saved: { id: 'tweet-a', slug: 'an-authored-tweet' },
      }),
    )
      .expectMount(WarnBeforeLeave({ dirty: false }))
      .resolve(ReconcileDraft, M.CompletedReconcileDraft({ operation: 1 }))
      .expect(Locator.text('Draft saved privately.'))
      .toExist()
  }),
)

it.effect('exposes native multipart upload progress and pause/retry controls for mixes', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(CreatorPageNoDeps, { url: '/new/mix', principal })

    s.expectMount(WarnBeforeLeave({ dirty: false }))
      .expectMount(AttachMarkdownEditor({ content: '', focus: false }))
      .expect(HtmlLocator.role('progressbar', { name: 'Audio upload progress' }))
      .toExist()
      .expect(HtmlLocator.role('button', { name: 'Pause upload' }))
      .toBeDisabled()
      .expect(HtmlLocator.role('button', { name: 'Resume upload' }))
      .toBeDisabled()
      .expect(HtmlLocator.role('textbox', { name: 'Existing audio URL' }))
      .toExist()
  }),
)

it.effect('declares a native kit review dialog and handles its dismissal without losing text', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(CreatorPageNoDeps, { url: '/new/tweet', principal })

    s.expectMount(WarnBeforeLeave({ dirty: false }))
      .expectMount(AttachMarkdownEditor({ content: '', focus: false }))
      .type(HtmlLocator.role('textbox', { name: 'Title' }), 'Review first')
      .expectMount(WarnBeforeLeave({ dirty: true }))
      .click(HtmlLocator.role('button', { name: 'Continue' }))
      .expect(HtmlLocator.role('dialog', { name: 'Publish post', hidden: true }))
      .toExist()
      .expect(HtmlLocator.role('button', { name: 'Keep editing', hidden: true }))
      .toHaveAttribute('autofocus', '')
      .childEmit(Dialog, 'publish', DialogEvents.RequestedClose({ reason: 'escape-key' }))
      .expect(HtmlLocator.role('dialog', { name: 'Publish post', hidden: true }))
      .toBeAbsent()
      .expect(HtmlLocator.role('textbox', { name: 'Title' }))
      .toHaveValue('Review first')
  }),
)

it.effect('reveals only the selected attachment panel and declares input and return focus', () =>
  Effect.gen(function* () {
    const s = yield* HtmlScene.make(CreatorPageNoDeps, { url: '/new/tweet', principal })

    s.expectMount(WarnBeforeLeave({ dirty: false }))
      .expectMount(AttachMarkdownEditor({ content: '', focus: false }))
      .expect(HtmlLocator.role('textbox', { name: 'Music URL' }))
      .toBeAbsent()
      .click(HtmlLocator.role('button', { name: 'Music' }))
      .expectMount(FocusAttachmentInput())
      .type(HtmlLocator.role('textbox', { name: 'Music URL' }), 'https://music.test/album')
      .expectMount(WarnBeforeLeave({ dirty: true }))
      .click(HtmlLocator.role('button', { name: 'Media' }))
      .expectMount(FocusAttachmentInput())
      .expect(HtmlLocator.role('textbox', { name: 'Music URL' }))
      .toBeAbsent()
      .type(
        HtmlLocator.role('textbox', { name: 'Embed media' }),
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      )
      .click(HtmlLocator.role('button', { name: 'Embed' }))
      .expectMount(FocusAttachmentTool())
      .expectMount(
        AttachMarkdownEditor({
          content: '::media{url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"}',
          focus: false,
        }),
      )
      .expect(HtmlLocator.role('textbox', { name: 'Embed media' }))
      .toBeAbsent()
      .loaded('diagnostics', [])
  }),
)

it.effect(
  'opens an empty body from its summary rather than preventing the browser toggle without a transition',
  () =>
    Effect.gen(function* () {
      const s = yield* HtmlScene.make(CreatorPageNoDeps, { url: '/new/tweet', principal })

      s.expectMount(WarnBeforeLeave({ dirty: false }))
        .expectMount(AttachMarkdownEditor({ content: '', focus: false }))
        .click(Locator.text('+ Add a longer note'))
        .expectMount(AttachMarkdownEditor({ content: '', focus: true }))
        .expect(Locator.text('Longer note'))
        .toExist()
    }),
)
