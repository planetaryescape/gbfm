import { Html } from '@effect/ui/html'
import { canCreatePosts } from '@gbfm/core/roles'
import { Schema } from 'effect'

import { Principal } from '../../domain/principal'
import { selection } from './domain'
import {
  GetDiagnostics,
  GetEditable,
  GetMusicReferences,
  GetPreview,
  SearchAuthors,
  GetMusicCatalogue,
} from './queries'
import { CreatorPageMessage, CreatorPageModel } from './state'

export const CreatorPageDef = Html.component({
  name: 'CreatorPage',
  props: Schema.Struct({ url: Schema.String, principal: Principal }),
  model: CreatorPageModel,
  message: CreatorPageMessage,
  restore: (model): CreatorPageModel => ({
    ...model,
    saving: false,
    legacyBusy: false,
    review: false,
    discarding: false,
    mosaicBusy: false,
    artworkBusy: false,
    remoteKind: null,
    focusBody: false,
    returnFocus: null,
    musicPending: false,
    quotePending: false,
    uploadState: 'idle',
  }),
  queries: {
    diagnostics: {
      query: GetDiagnostics,
      debounce: '300 millis',
      args: ({ model, props }) =>
        model.draft.content
          ? { content: model.draft.content, principalId: props.principal.id }
          : undefined,
    },
    music: {
      query: GetMusicCatalogue,
      debounce: '300 millis',
      args: ({ model, props }) =>
        model.musicQuery.trim().length >= 2 ? { principalId: props.principal.id } : undefined,
    },
    editable: {
      query: GetEditable,
      args: ({ props, model }) => {
        const { kind, slug } = selection(props.url)

        return slug && canCreatePosts(props.principal.role)
          ? { kind, slug, principalId: props.principal.id, attempt: model.editableAttempt }
          : undefined
      },
      onChange: () => CreatorPageMessage.ChangedEditable(),
    },
    authors: {
      query: SearchAuthors,
      debounce: '300 millis',
      args: ({ model, props }) =>
        model.authorQuery.trim()
          ? {
              query: model.authorQuery,
              principalId: props.principal.id,
              attempt: model.authorAttempt,
            }
          : undefined,
    },
    preview: {
      query: GetPreview,
      debounce: '300 millis',
      args: ({ model, props }) =>
        (model.mode === 'preview' || model.review) && model.draft.content
          ? {
              content: model.draft.content,
              principalId: props.principal.id,
              attempt: model.previewAttempt,
            }
          : undefined,
    },
    attachmentPreview: {
      query: GetPreview,
      args: ({ model, props }) =>
        model.draft.musicEntityType && model.draft.musicEntityId
          ? {
              content: `::music{type="${model.draft.musicEntityType}" id="${model.draft.musicEntityId}"}`,
              principalId: props.principal.id,
              attempt: model.previewAttempt,
            }
          : undefined,
    },
    references: {
      queryMany: GetMusicReferences,
      args: ({ model }) => {
        const { musicEntityType, musicEntityId } = model.draft

        return musicEntityType && musicEntityId
          ? model.referenceOffsets.map((offset) => ({
              entityType: musicEntityType,
              entityId: musicEntityId,
              offset,
              attempt: model.referenceRevision + model.previewAttempt,
            }))
          : []
      },
    },
  },
})
