import { Command, Component, Subscription } from '@effect/ui'
import { HtmlSubscription } from '@effect/ui/html'
import { canCreatePosts } from '@gbfm/core/roles'
import { mediaReference, SUPPORTED_MEDIA_HINT } from '@gbfm/rich-content/media'
import { Effect, Layer, Option, Predicate, Schema, Stream } from 'effect'

import { CreatorPageDef as D } from './definition'
import {
  appendBlock,
  draftKey,
  emptyDraft,
  insertBanner,
  sameDraft,
  selection,
  tweetSlug,
  validation,
} from './domain'
import { CreatorLegacyRecoveryLive } from './legacy-recovery'
import { mosaicSource } from './mosaic'
import {
  CancelUpload,
  GenerateMosaic,
  PauseUpload,
  ReadDraft,
  ReadLegacyRecovery,
  ReconcileDraft,
  ResolveMusic,
  ResolveQuote,
  ResolveLegacyRecovery,
  ResolvePostMusic,
  SaveContent,
  UploadArtwork,
  UploadAudio,
  WriteDraft,
} from './operations'
import {
  GetDiagnostics,
  GetEditable,
  GetMusicReferences,
  GetPreview,
  SearchAuthors,
  GetMusicCatalogue,
} from './queries'
import { CreatorServiceLive } from './services'
import { CreatorPageMessage as M } from './state'
import { CreatorUpload, CreatorUploadLive } from './upload/runtime'
import { CreatorView } from './view'

const save = D.update(($, message) => {
  if (
    !canCreatePosts($.props.principal.role) ||
    !$.model.ready ||
    $.model.saving ||
    $.model.legacyRecovery !== null ||
    $.model.episodeError ||
    $.model.artworkBusy
  )
    return $.model
  const error = validation($.model.draft)

  if (error) return $.evolve({ error })
  const publish = Predicate.isTagged(message, 'RequestedPublish')

  if (publish && !$.model.review) return $.model
  const operation = $.model.operation + 1

  return $.evolve({ operation, saving: true, remoteKind: 'save', error: null }).run(
    SaveContent.make({
      draft: $.model.draft,
      creatorId: $.props.principal.id,
      revision: $.model.revision,
      operation,
      publish,
    }),
  )
})

const edited = D.update(($) =>
  $.evolve({
    revision: (revision) => revision + 1,
    error: null,
    notice: null,
    published: false,
  }),
)

const resolveLegacy = (action: 'restore' | 'dismiss') =>
  D.update(($) => {
    if (
      $.model.legacyBusy ||
      !$.model.legacyRecovery ||
      $.props.principal.username !== 'guidefari' ||
      $.model.legacyRecovery.ownerId !== $.props.principal.id
    )
      return $.model

    return $.evolve({ legacyBusy: true }).run(
      ResolveLegacyRecovery.make({
        key: draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug),
        revision: $.model.revision,
        principal: $.props.principal,
        token: $.model.legacyRecovery,
        action,
      }),
    )
  })

const restoreLegacy = resolveLegacy('restore')

const dismissLegacy = resolveLegacy('dismiss')

export const CreatorPageNoDeps = D.make({
  init: ($) => {
    const { kind, slug } = selection($.props.url)

    return {
      draft: emptyDraft(kind, $.props.principal.id, slug),
      checkpointSlug: slug,
      choosing:
        new URL($.props.url, 'https://gbfm.local').pathname.replace(/\/$/, '') === '/new' && !slug,
      recovery: null,
      legacyRecovery: null,
      legacyBusy: false,
      recovered: false,
      savedDraft: emptyDraft(kind, $.props.principal.id, slug),
      ready: !slug,
      revision: 0,
      savedRevision: 0,
      localRevision: 0,
      operation: 0,
      saving: false,
      published: false,
      review: false,
      mode: 'source',
      error: null,
      localError: null,
      episodeInput: '',
      episodeError: null,
      remoteKind: null,
      musicRevision: 0,
      musicPending: false,
      quoteRevision: 0,
      quotePending: false,
      artworkRevision: 0,
      focusBody: false,
      notice: null,
      authorQuery: '',
      tagsInput: '',
      authorAttempt: 0,
      attachment: null,
      returnFocus: null,
      musicQuery: '',
      mediaUrl: '',
      mediaError: null,
      musicTitle: '',
      quoteTitle: '',
      authorLabels: {
        [$.props.principal.id]:
          $.props.principal.name || $.props.principal.username || $.props.principal.id,
      },
      bodyOpen: false,
      discarding: false,
      mosaicBusy: false,
      mosaicOperation: 0,
      mosaicContent: null,
      artworkBusy: false,
      mosaic: null,
      referenceOffset: 0,
      referenceOffsets: [0],
      referenceRevision: 0,
      previewAttempt: 0,
      editableAttempt: 0,
      uploadState: 'idle',
      uploadPercent: 0,
    }
  },
  update: {
    UpdatedField: ($, { field, value }) => {
      if (!$.model.ready || !canCreatePosts($.props.principal.role)) return $.model

      if ($.model.draft[field] === value) return $.model

      if (field === 'quoteUrl' && $.model.draft.editSlug) return $.model

      const next = $.combine(edited).evolve({
        draft: (draft) => ({ ...draft, [field]: value }),
        bodyOpen: $.model.bodyOpen || (field === 'content' && Boolean(value.trim())),
      })

      if (field === 'content' && $.model.recovered && !$.model.recovery)
        return next.run(
          WriteDraft.make({
            key: draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug),
            draft: { ...$.model.draft, content: value },
            revision: $.model.revision + 1,
          }),
        )

      if (field === 'musicUrl')
        return next.evolve({
          musicRevision: (n) => n + 1,
          musicPending: false,
          operation: $.model.operation + ($.model.remoteKind === 'music' ? 1 : 0),
          saving: $.model.remoteKind === 'music' ? false : $.model.saving,
          remoteKind: $.model.remoteKind === 'music' ? null : $.model.remoteKind,
        })

      if (field === 'quoteUrl')
        return next.evolve({
          quoteRevision: (n) => n + 1,
          quotePending: false,
          quoteTitle: '',
          draft: (draft) => ({ ...draft, quotedPostId: null }),
        })

      return next
    },
    UpdatedTags: ($, { value }) =>
      $.combine(edited).evolve({
        tagsInput: value,
        draft: (draft) => ({
          ...draft,
          tags: value
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      }),
    UpdatedEpisode: ($, { value }) => {
      const episodeNumber = value.trim() ? Number(value) : null

      if (episodeNumber !== null && (!Number.isSafeInteger(episodeNumber) || episodeNumber < 1))
        return $.evolve({
          episodeInput: value,
          episodeError: 'Episode number must be a positive whole number.',
        })

      return $.combine(edited).evolve({
        episodeInput: value,
        episodeError: null,
        draft: (draft) => ({ ...draft, episodeNumber }),
      })
    },
    UpdatedShow: ($, { value }) =>
      $.combine(edited).evolve({ draft: (draft) => ({ ...draft, showId: value.trim() || null }) }),
    UpdatedAuthorQuery: ($, { value }) => $.evolve({ authorQuery: value }),
    RequestedAuthors: ($) => $.evolve({ authorAttempt: (n) => n + 1 }),
    ClickedAttachment: ($, { attachment }) =>
      $.evolve({
        attachment: $.model.attachment === attachment ? null : attachment,
        returnFocus: null,
      }),
    ToggledBodyEditor: ($, { open }) => {
      if (!open && $.model.draft.content.trim()) return $.model

      return $.evolve({ bodyOpen: open, focusBody: open, mode: open ? 'source' : $.model.mode })
    },
    UpdatedMusicQuery: ($, { value }) => $.evolve({ musicQuery: value }),
    PickedMusic: ($, { entityType, entityId, title, image }) =>
      $.combine(edited).evolve({
        draft: (draft) => ({
          ...draft,
          musicEntityType: entityType,
          musicEntityId: entityId,
          musicUrl: '',
          thumbnailUrl: draft.thumbnailUrl || image || '',
        }),
        musicTitle: title,
        musicQuery: '',
        referenceOffset: 0,
        referenceOffsets: [0],
        referenceRevision: (n) => n + 1,
        musicRevision: (n) => n + 1,
        musicPending: false,
      }),
    PickedAuthor: ($, { id }) => {
      const results = $.queries.authors

      const author = Predicate.isTagged(results, 'Success')
        ? results.value.find((item) => item.id === id)
        : undefined

      if (!author || $.model.draft.creatorIds.includes(id)) return $.model

      return $.combine(edited).evolve({
        draft: (draft) => ({
          ...draft,
          creatorIds: [...draft.creatorIds, id],
        }),
        authorLabels: (labels) => ({
          ...labels,
          [id]: author?.name || author?.username || labels[id] || id,
        }),
      })
    },
    ClickedRemoveAuthor: ($, { id }) =>
      $.model.draft.creatorIds.length > 1 && $.model.draft.creatorIds.includes(id)
        ? $.combine(edited).evolve({
            draft: (draft) => ({
              ...draft,
              creatorIds: draft.creatorIds.filter((item) => item !== id),
            }),
          })
        : $.model,
    PickedKind: ($, { kind }) => {
      if (
        $.model.saving ||
        $.model.artworkBusy ||
        $.model.legacyRecovery !== null ||
        $.model.draft.editSlug ||
        $.model.uploadState !== 'idle'
      )
        return $.model

      if (kind === $.model.draft.kind && !$.model.choosing) return $.model

      if ($.model.revision !== $.model.savedRevision)
        return $.combine(edited).evolve({
          draft: (draft) => ({ ...draft, kind }),
          savedDraft: emptyDraft(kind, $.props.principal.id),
          choosing: false,
          musicRevision: (n) => n + 1,
          musicPending: false,
          quoteRevision: (n) => n + 1,
          quotePending: false,
        })

      return $.evolve({
        draft: emptyDraft(kind, $.props.principal.id),
        savedDraft: emptyDraft(kind, $.props.principal.id),
        choosing: false,
        recovered: false,
        revision: 0,
        savedRevision: 0,
        localRevision: 0,
        bodyOpen: false,
        focusBody: false,
        episodeInput: '',
        episodeError: null,
        musicRevision: (n) => n + 1,
        musicPending: false,
        quoteRevision: (n) => n + 1,
        quotePending: false,
        artworkRevision: (n) => n + 1,
        mosaicOperation: (n) => n + 1,
        mosaicBusy: false,
        mosaic: null,
      })
    },
    ChangedEditable: ($) => {
      const result = $.queries.editable

      if (Predicate.isTagged(result, 'Failure'))
        return $.evolve({ error: 'Could not load this draft. Reload to try again.' })

      if (!Predicate.isTagged(result, 'Success') || $.model.ready) return $.model

      return $.evolve({
        draft: result.value,
        tagsInput: result.value.tags.join(', '),
        savedDraft: result.value,
        ready: true,
        bodyOpen: Boolean(result.value.content.trim()),
        episodeInput: result.value.episodeNumber?.toString() ?? '',
        authorLabels: Object.fromEntries(
          result.value.creators.map((author) => [
            author.id,
            author.name || author.username || author.id,
          ]),
        ),
      })
    },
    RequestedReloadEditable: ($) =>
      $.model.ready
        ? $.model
        : $.evolve({ editableAttempt: (attempt) => attempt + 1, error: null }),
    RequestedRecovery: ($) =>
      $.run(
        ReadDraft.make({
          key: draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug),
          revision: $.model.revision,
        }),
      ),
    CompletedReadDraft: ($, { key, draft, revision }) => {
      if (key !== draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug))
        return $.model

      if (!draft && revision === $.model.revision && $.props.principal.username === 'guidefari')
        return $.evolve({ recovered: true }).run(
          ReadLegacyRecovery.make({ key, revision, principal: $.props.principal }),
        )

      if (revision !== $.model.revision || !draft || sameDraft(draft, $.model.draft))
        return $.evolve({ recovered: true })

      if (!$.model.draft.editSlug && revision === 0) {
        let attachment: typeof $.model.attachment = null

        if (draft.musicUrl && !draft.musicEntityId) attachment = 'music'
        else if (draft.quoteUrl && !draft.quotedPostId) attachment = 'quote'

        return $.evolve({
          draft,
          recovered: true,
          revision: 1,
          localRevision: 1,
          bodyOpen: Boolean(draft.content.trim()),
          focusBody: false,
          tagsInput: draft.tags.join(', '),
          episodeInput: draft.episodeNumber?.toString() ?? '',
          attachment,
          musicRevision: (n) => n + 1,
          quoteRevision: (n) => n + 1,
        })
      }

      return $.evolve({ recovery: draft, recovered: true })
    },
    CompletedReadLegacyRecovery: ($, { key, revision, candidate }) => {
      if (
        key !== draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug) ||
        revision !== $.model.revision ||
        $.model.saving ||
        $.model.legacyBusy ||
        $.props.principal.username !== 'guidefari' ||
        !candidate ||
        candidate.token.ownerId !== $.props.principal.id
      )
        return $.model

      return $.evolve({ recovery: candidate.draft, legacyRecovery: candidate.token })
    },
    CompletedResolveLegacyRecovery: ($, { key, revision, token, draft }) => {
      if (
        key !== draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug) ||
        !$.model.legacyBusy ||
        $.props.principal.username !== 'guidefari' ||
        token.ownerId !== $.props.principal.id ||
        token.fingerprint !== $.model.legacyRecovery?.fingerprint ||
        token.key !== $.model.legacyRecovery?.key
      )
        return $.model
      const cleared = $.evolve({ recovery: null, legacyRecovery: null, legacyBusy: false })

      if (!draft || revision !== $.model.revision) return cleared

      return $.combine(edited).evolve({
        recovery: null,
        legacyRecovery: null,
        legacyBusy: false,
        localError: null,
        draft,
        tagsInput: draft.tags.join(', '),
        bodyOpen: Boolean(draft.content.trim()),
        episodeInput: draft.episodeNumber?.toString() ?? '',
        musicRevision: (n) => n + 1,
        musicPending: false,
        quoteRevision: (n) => n + 1,
        quotePending: false,
      })
    },
    FailedLegacyRecovery: ($, { key, revision, message }) =>
      key === draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug) &&
      (revision === $.model.revision || $.model.legacyBusy)
        ? $.evolve({ legacyBusy: false, localError: message })
        : $.model,
    ClickedRecover: ($) => {
      if ($.model.legacyRecovery) return $.combine(restoreLegacy)

      return $.model.recovery
        ? $.combine(edited).evolve({
            draft: $.model.recovery,
            tagsInput: $.model.recovery.tags.join(', '),
            recovery: null,
            bodyOpen: Boolean($.model.recovery.content.trim()),
            episodeInput: $.model.recovery.episodeNumber?.toString() ?? '',
            musicRevision: (n) => n + 1,
            musicPending: false,
            quoteRevision: (n) => n + 1,
            quotePending: false,
          })
        : $.model
    },
    ClickedDismissRecovery: ($) => {
      if ($.model.legacyRecovery) return $.combine(dismissLegacy)

      return $.evolve({ recovery: null }).run(
        WriteDraft.make({
          key: draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug),
          draft: $.model.draft,
          revision: $.model.revision,
        }),
      )
    },
    RequestedSave: save,
    RequestedPublish: save,
    RequestedAutosave: ($) => {
      if (!$.model.ready || $.model.recovery || $.model.revision <= $.model.savedRevision)
        return $.model

      return $.run(
        WriteDraft.make({
          key: draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug),
          draft: $.model.draft,
          revision: $.model.revision,
        }),
      )
    },
    SucceededSaveContent: ($, { operation, revision, saved, draft, publish }) => {
      if (!$.model.saving || $.model.remoteKind !== 'save' || operation !== $.model.operation)
        return $.model
      const current = $.model.draft
      const retained = revision !== $.model.revision ? current : null

      const updated = {
        ...current,
        editSlug: saved.slug,
        postId: current.kind === 'mix' ? undefined : saved.id,
        slug: current.slug === draft.slug ? saved.slug : current.slug,
        expectedUpdatedAt: saved.updatedAt ?? current.expectedUpdatedAt,
      }

      let notice = 'Draft saved privately.'

      if (publish)
        notice = retained
          ? 'Published the saved version. Newer edits remain unpublished.'
          : 'Published.'

      return $.evolve({
        draft: updated,
        saving: false,
        remoteKind: null,
        localError: retained ? $.model.localError : null,
        savedRevision: revision,
        review: false,
        savedDraft: {
          ...draft,
          editSlug: saved.slug,
          postId: draft.kind === 'mix' ? undefined : saved.id,
          slug: saved.slug,
          expectedUpdatedAt: saved.updatedAt ?? draft.expectedUpdatedAt,
        },
        published: publish && !retained,
        notice,
        localRevision: retained ? -1 : revision,
      })
        .run(Command.interrupt(WriteDraft))
        .run(
          ReconcileDraft.make({
            key: draftKey($.props.principal.id, draft, $.model.checkpointSlug),
            saved: draft,
            remote: saved,
            retained,
            operation,
          }),
        )
    },
    FailedOperation: ($, { operation, message }) =>
      $.model.saving && operation === $.model.operation
        ? $.evolve({ saving: false, remoteKind: null, musicPending: false, error: message })
        : $.model,
    CompletedWriteDraft: ($, { key, revision }) =>
      key === draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug) &&
      revision === $.model.revision &&
      revision > $.model.savedRevision
        ? $.evolve({ localRevision: revision, localError: null })
        : $.model,
    CompletedReconcileDraft: ($) => $.model,
    FailedReconcileDraft: ($, { operation, message }) =>
      operation === $.model.operation ? $.evolve({ localError: message }) : $.model,
    FailedReadDraft: ($, { key, revision, message }) =>
      key === draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug) &&
      revision === $.model.revision
        ? $.evolve({ recovered: true, localError: message })
        : $.model,
    FailedWriteDraft: ($, { key, revision, message }) =>
      key === draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug) &&
      revision === $.model.revision &&
      revision > $.model.savedRevision
        ? $.evolve({ localError: message })
        : $.model,
    FailedResolveMusic: ($, { revision, message }) =>
      $.model.musicPending && revision === $.model.musicRevision
        ? $.evolve({ musicPending: false, error: message })
        : $.model,
    FailedResolveQuote: ($, { revision, message }) =>
      $.model.quotePending && revision === $.model.quoteRevision && !$.model.draft.editSlug
        ? $.evolve({ quotePending: false, error: message })
        : $.model,
    RequestedOpenReview: ($) =>
      $.evolve({
        review: !$.model.episodeError && validation($.model.draft) === null,
        error: validation($.model.draft),
      }),
    RequestedCloseReview: ($) => {
      if ($.model.saving) return $.model
      const next = $.evolve({ review: false })

      if (
        !canCreatePosts($.props.principal.role) ||
        !$.model.ready ||
        !$.model.recovered ||
        $.model.recovery ||
        $.model.revision <= $.model.savedRevision
      )
        return next

      return next.run(
        WriteDraft.make({
          key: draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug),
          draft: $.model.draft,
          revision: $.model.revision,
        }),
      )
    },
    PickedEditorMode: ($, { mode }) => $.evolve({ mode }),
    ClickedFormat: ($, { before, after, sample }) => {
      if ($.model.mode !== 'source') return $.model

      return $.combine(edited).evolve({
        draft: (draft) => ({
          ...draft,
          content: `${draft.content}${draft.content ? '\n' : ''}${before}${sample}${after}`,
        }),
        bodyOpen: true,
      })
    },
    RequestedMusic: ($) => {
      if ($.model.saving) return $.model
      const draft = $.model.draft

      if (draft.postId) {
        const operation = $.model.operation + 1

        return $.evolve({
          operation,
          saving: true,
          remoteKind: 'music',
          musicPending: true,
          error: null,
        }).run(
          ResolvePostMusic.make({
            postId: draft.postId,
            url: draft.musicUrl,
            expectedUpdatedAt: draft.expectedUpdatedAt,
            operation,
          }),
        )
      }

      const revision = $.model.musicRevision + 1

      return $.evolve({ musicRevision: revision, musicPending: true }).run(
        ResolveMusic.make({ url: draft.musicUrl, kind: draft.kind, revision }),
      )
    },
    SucceededResolvePostMusic: (
      $,
      { operation, postId, updatedAt, entityType, entityId, title, image },
    ) => {
      if (
        !$.model.saving ||
        $.model.remoteKind !== 'music' ||
        operation !== $.model.operation ||
        postId !== $.model.draft.postId
      )
        return $.model

      return $.combine(edited).evolve({
        saving: false,
        remoteKind: null,
        musicPending: false,
        notice: 'Music attachment saved.',
        attachment: null,
        returnFocus: 'music',
        musicTitle: title,
        referenceOffset: 0,
        referenceOffsets: [0],
        referenceRevision: (n) => n + 1,
        savedDraft: (draft) => ({
          ...draft,
          expectedUpdatedAt: updatedAt ?? draft.expectedUpdatedAt,
          musicEntityType: entityType,
          musicEntityId: entityId,
        }),
        draft: (draft) => ({
          ...draft,
          expectedUpdatedAt: updatedAt ?? draft.expectedUpdatedAt,
          musicEntityType: entityType,
          musicEntityId: entityId,
          thumbnailUrl: draft.thumbnailUrl || image || '',
        }),
      })
    },
    SucceededResolveMusic: ($, { revision, entityType, entityId, title, image }) => {
      if (!$.model.musicPending || revision !== $.model.musicRevision) return $.model

      return $.combine(edited).evolve({
        draft: (draft) => ({
          ...draft,
          musicEntityType: entityType,
          musicEntityId: entityId,
          thumbnailUrl: draft.thumbnailUrl || image || '',
        }),
        musicTitle: title,
        referenceOffset: 0,
        referenceOffsets: [0],
        referenceRevision: (n) => n + 1,
        musicPending: false,
        attachment: null,
        returnFocus: 'music',
      })
    },
    RequestedQuote: ($) => {
      if ($.model.draft.editSlug) return $.model

      if (!tweetSlug($.model.draft.quoteUrl))
        return $.evolve({ error: 'resolve quote: Paste a complete goosebumps.fm tweet URL.' })

      const revision = $.model.quoteRevision + 1

      return $.evolve({ quoteRevision: revision, quotePending: true }).run(
        ResolveQuote.make({ url: $.model.draft.quoteUrl, revision }),
      )
    },
    SucceededResolveQuote: ($, { revision, id, title }) =>
      $.model.quotePending && revision === $.model.quoteRevision && !$.model.draft.editSlug
        ? $.combine(edited).evolve({
            draft: (draft) => ({ ...draft, quotedPostId: id }),
            quoteTitle: title,
            quotePending: false,
            attachment: null,
            returnFocus: 'quote',
          })
        : $.model,
    ClickedRemoveMusic: ($) =>
      $.combine(edited).evolve({
        draft: (draft) => ({ ...draft, musicEntityId: null, musicEntityType: null, musicUrl: '' }),
        musicTitle: '',
        attachment: 'music',
        returnFocus: null,
        musicRevision: (n) => n + 1,
        musicPending: false,
        referenceOffsets: [0],
        referenceOffset: 0,
        referenceRevision: (n) => n + 1,
        operation: $.model.operation + ($.model.remoteKind === 'music' ? 1 : 0),
        saving: $.model.remoteKind === 'music' ? false : $.model.saving,
        remoteKind: $.model.remoteKind === 'music' ? null : $.model.remoteKind,
      }),
    ClickedRemoveQuote: ($) =>
      $.model.draft.editSlug
        ? $.model
        : $.combine(edited).evolve({
            draft: (draft) => ({ ...draft, quotedPostId: null, quoteUrl: '' }),
            quoteTitle: '',
            attachment: 'quote',
            returnFocus: null,
            quotePending: false,
            quoteRevision: (n) => n + 1,
          }),
    ClickedInsertMusic: ($) =>
      $.model.draft.musicEntityId
        ? $.combine(edited).evolve({
            draft: (draft) => ({
              ...draft,
              content: appendBlock(
                draft.content,
                `::music{type="${draft.musicEntityType}" id="${draft.musicEntityId}"}`,
              ),
            }),
            bodyOpen: true,
          })
        : $.model,
    UpdatedMediaUrl: ($, { value }) => $.evolve({ mediaUrl: value, mediaError: null }),
    ClickedInsertMedia: ($) => {
      const url = Schema.decodeUnknownOption(Schema.URLFromString)($.model.mediaUrl.trim())

      if (Option.isNone(url))
        return $.evolve({
          mediaError: `This link has no embeddable player. ${SUPPORTED_MEDIA_HINT}`,
        })

      if (url.value.protocol === 'http:') url.value.protocol = 'https:'

      const media = mediaReference(url.value)

      if (
        !media ||
        url.value.username ||
        url.value.password ||
        url.value.port ||
        url.value.protocol !== 'https:'
      )
        return $.evolve({
          mediaError: `This link has no embeddable player. ${SUPPORTED_MEDIA_HINT}`,
        })

      return $.combine(edited).evolve({
        draft: (draft) => ({
          ...draft,
          content: appendBlock(draft.content, `::media{url="${url.value.href}"}`),
        }),
        mediaUrl: '',
        mediaError: null,
        attachment: null,
        returnFocus: 'media',
        bodyOpen: true,
      })
    },
    ChoseArtwork: ($, { files: [file] }) =>
      file
        ? $.evolve({ artworkBusy: true, artworkRevision: $.model.artworkRevision + 1 }).run(
            UploadArtwork.make({
              file,
              kind: $.model.draft.kind,
              revision: $.model.artworkRevision + 1,
              previousUrl: $.model.draft.thumbnailUrl,
            }),
          )
        : $.model,
    RequestedMosaic: ($) => {
      if ($.model.mosaicBusy || $.model.saving || !canCreatePosts($.props.principal.role))
        return $.model
      const operation = $.model.mosaicOperation + 1
      const content = mosaicSource($.model.draft)

      return $.evolve({
        mosaicBusy: true,
        mosaicOperation: operation,
        mosaicContent: content,
        error: null,
      }).run(GenerateMosaic.make({ content, operation }))
    },
    SucceededGenerateMosaic: ($, { operation, content, url }) =>
      $.model.mosaicBusy &&
      operation === $.model.mosaicOperation &&
      content === $.model.mosaicContent
        ? $.evolve({ mosaicBusy: false, mosaic: { content, url } })
        : $.model,
    FailedGenerateMosaic: ($, { operation, content, message }) =>
      $.model.mosaicBusy &&
      operation === $.model.mosaicOperation &&
      content === $.model.mosaicContent
        ? $.evolve({ mosaicBusy: false, error: message })
        : $.model,
    ClickedApplyMosaicCover: ($) =>
      $.model.mosaic && $.model.mosaic.content === mosaicSource($.model.draft)
        ? $.combine(edited).evolve({
            draft: (draft) => ({
              ...draft,
              thumbnailUrl: $.model.mosaic?.url ?? draft.thumbnailUrl,
            }),
          })
        : $.evolve({ error: 'The source changed. Generate the mosaic again before applying it.' }),
    ClickedApplyMosaicBanner: ($) =>
      $.model.mosaic && $.model.mosaic.content === mosaicSource($.model.draft)
        ? $.combine(edited).evolve({
            draft: (draft) => ({
              ...draft,
              content: insertBanner(draft.content, $.model.mosaic?.url ?? ''),
            }),
            mosaic: null,
          })
        : $.evolve({ error: 'The source changed. Generate the mosaic again before applying it.' }),
    ClickedDiscardMosaic: ($) => $.evolve({ mosaic: null, mosaicBusy: false, mosaicContent: null }),
    RequestedDiscard: ($) => $.evolve({ discarding: true }),
    RequestedCloseDiscard: ($) => $.evolve({ discarding: false }),
    ConfirmedDiscard: ($) => {
      if (!$.model.discarding) return $.model

      if ($.model.uploadState !== 'idle') return $.model
      const draft = $.model.savedDraft
      const revision = $.model.revision + 1

      return $.evolve({
        draft,
        tagsInput: draft.tags.join(', '),
        revision,
        savedRevision: revision,
        discarding: false,
        review: false,
        recovery: null,
        legacyRecovery: null,
        legacyBusy: false,
        recovered: true,
        error: null,
        mosaic: null,
        mosaicBusy: false,
        mosaicContent: null,
        mosaicOperation: (n) => n + 1,
        artworkBusy: false,
        artworkRevision: (n) => n + 1,
        operation: (n) => n + 1,
        saving: false,
        remoteKind: null,
        musicPending: false,
        musicRevision: (n) => n + 1,
        quotePending: false,
        quoteRevision: (n) => n + 1,
        localError: null,
        episodeError: null,
        episodeInput: draft.episodeNumber?.toString() ?? '',
        bodyOpen: Boolean(draft.content.trim()),
        focusBody: false,
        mediaUrl: '',
        mediaError: null,
        attachment: null,
        returnFocus: null,
        musicTitle: '',
        quoteTitle: '',
      })
        .run(Command.interrupt(WriteDraft))
        .run(
          WriteDraft.make({
            key: draftKey($.props.principal.id, $.model.draft, $.model.checkpointSlug),
            draft,
            revision,
          }),
        )
    },
    SucceededUploadArtwork: ($, { kind, revision, previousUrl, url }) => {
      if (
        !$.model.artworkBusy ||
        revision !== $.model.artworkRevision ||
        kind !== $.model.draft.kind
      )
        return $.model

      if (previousUrl !== $.model.draft.thumbnailUrl)
        return $.evolve({
          artworkBusy: false,
          notice: 'Artwork upload completed. Your newer artwork choice was kept.',
        })

      return $.combine(edited).evolve({
        draft: (draft) => ({ ...draft, thumbnailUrl: url }),
        artworkBusy: false,
      })
    },
    FailedUploadArtwork: ($, { kind, revision, message }) =>
      $.model.artworkBusy && revision === $.model.artworkRevision && kind === $.model.draft.kind
        ? $.evolve({ artworkBusy: false, error: message })
        : $.model,
    ChoseAudio: ($, { files: [file] }) =>
      file &&
      ($.model.uploadState === 'idle' ||
        $.model.uploadState === 'paused' ||
        $.model.uploadState === 'failed')
        ? $.evolve({ uploadState: 'running', uploadPercent: 0, error: null }).run(
            UploadAudio.make({ file }),
          )
        : $.model,
    SucceededUploadAudio: ($, { url }) =>
      $.combine(edited).evolve({
        draft: (draft) => ({ ...draft, audioUrl: url }),
        uploadState: 'idle',
        uploadPercent: 100,
      }),
    FailedUploadAudio: ($, { message, paused, checkpointPercent }) =>
      $.evolve({
        uploadState: paused ? 'paused' : 'failed',
        uploadPercent:
          paused && checkpointPercent !== undefined ? checkpointPercent : $.model.uploadPercent,
        error: paused ? null : message,
      }),
    ProgressedUpload: ($, { percent }) =>
      $.model.uploadState === 'running' || $.model.uploadState === 'pausing'
        ? $.evolve({ uploadPercent: Math.max($.model.uploadPercent, percent) })
        : $.model,
    ClickedPauseUpload: ($) =>
      $.model.uploadState === 'running'
        ? $.evolve({ uploadState: 'pausing' }).run(PauseUpload.make())
        : $.model,
    CompletedPauseUpload: ($) => $.model,
    ClickedResumeUpload: ($) =>
      $.model.uploadState === 'paused' || $.model.uploadState === 'failed'
        ? $.evolve({ uploadState: 'running', error: null }).run(UploadAudio.make({}))
        : $.model,
    ClickedCancelUpload: ($) => {
      if ($.model.uploadState === 'running' || $.model.uploadState === 'pausing')
        return $.evolve({ error: 'Pause the upload before cancelling.' })

      if ($.model.uploadState !== 'paused' && $.model.uploadState !== 'failed') return $.model

      return $.evolve({ uploadState: 'cancelling' }).run(CancelUpload.make())
    },
    CompletedCancelUpload: ($) => $.evolve({ uploadState: 'idle', uploadPercent: 0, error: null }),
    ClickedMoreReferences: ($) => {
      const pages = $.queries.references
      const last = pages.at(-1)

      if (
        !last ||
        !Predicate.isTagged(last.result, 'Success') ||
        !last.result.value.pagination.hasMore ||
        last.result.value.data.length === 0
      )
        return $.model

      const offset = last.args.offset + last.result.value.data.length

      return $.evolve({
        referenceOffset: offset,
        referenceOffsets: (offsets) => [...offsets, offset],
      })
    },
    ClickedRetryPreview: ($) => $.evolve({ mode: 'preview', previewAttempt: (n) => n + 1 }),
    ClickedRetryMusicPreview: ($) => $.evolve({ previewAttempt: (n) => n + 1 }),
  },
  subscriptions: ({ model, props }) => [
    model.ready &&
      !model.choosing &&
      !model.recovered &&
      canCreatePosts(props.principal.role) &&
      Subscription.make(
        'recovery',
        draftKey(props.principal.id, model.draft, model.checkpointSlug),
        () => Stream.succeed(M.RequestedRecovery()),
      ),
    model.ready &&
      model.recovered &&
      !model.recovery &&
      model.revision > model.savedRevision &&
      model.revision > model.localRevision &&
      Subscription.make('autosave', model.revision, () =>
        Stream.fromEffect(Effect.sleep('2 seconds').pipe(Effect.as(M.RequestedAutosave()))),
      ),
    model.uploadState !== 'idle' &&
      Subscription.make('upload-progress', null, () =>
        Stream.unwrap(
          Effect.gen(function* () {
            const upload = yield* CreatorUpload

            return upload.progress.pipe(
              Stream.map((progress) =>
                M.ProgressedUpload({
                  percent: progress.totalBytes
                    ? (progress.bytesUploaded / progress.totalBytes) * 100
                    : 0,
                }),
              ),
            )
          }),
        ),
      ),
    HtmlSubscription.onDocument(
      'keydown',
      ({ key, ctrl, meta }) => ((ctrl || meta) && key === 's' ? M.RequestedSave() : undefined),
      { preventDefault: true },
    ),
  ],
  view: CreatorView,
})

export const creatorRuntimeLayer = Layer.mergeAll(
  ReadLegacyRecovery.layer,
  ResolveLegacyRecovery.layer,
  ReadDraft.layer,
  WriteDraft.layer,
  SaveContent.layer,
  ReconcileDraft.layer,
  ResolveMusic.layer,
  ResolveQuote.layer,
  ResolvePostMusic.layer,
  UploadArtwork.layer,
  GenerateMosaic.layer,
  UploadAudio.layer,
  PauseUpload.layer,
  CancelUpload.layer,
  GetEditable.layer,
  SearchAuthors.layer,
  GetPreview.layer,
  GetMusicReferences.layer,
  GetMusicCatalogue.layer,
  GetDiagnostics.layer,
)

export const CreatorPage = CreatorPageNoDeps.pipe(
  Component.provide(
    creatorRuntimeLayer.pipe(
      Layer.provide(CreatorServiceLive),
      Layer.provide(CreatorLegacyRecoveryLive),
      Layer.provideMerge(CreatorUploadLive),
    ),
  ),
)
