import { Command, Component, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { CreatePlaylistInput, UpdatePlaylistInput } from '@gbfm/api/music'
import { CreateShowInput, UpdateShowInput } from '@gbfm/api/shows'
import { Effect, Layer, Predicate, Schema } from 'effect'

import { Principal } from '../../domain/principal'
import { DashboardDocument } from './document'
import { plural } from './formatting'
import { Field, Notice } from './presentation'
import { DashboardService, DashboardServiceLive, ReadDashboard } from './service'

const LibraryAction = Schema.Literals([
  'save',
  'delete',
  'import',
  'add',
  'remove',
  'reorder',
  'sync',
])

export const LibraryMessage = UiSchema.TaggedEnum({
  ClickedNew: {},
  ClickedBack: {},
  ClickedEdit: { id: Schema.String },
  UpdatedField: { name: Schema.String, value: Schema.String },
  ToggledDraft: {},
  ClickedRefresh: { offset: Schema.Number },
  ChangedDocument: {},
  ClickedDelete: {},
  ClickedCancelDelete: {},
  ClickedAction: { action: LibraryAction, trackId: Schema.String },
  ClickedMove: { id: Schema.String, direction: Schema.Literals(['up', 'down']) },
  SucceededWrite: {
    action: LibraryAction,
    selected: Schema.NullOr(Schema.String),
    notice: Schema.String,
  },
  FailedWrite: { message: Schema.String },
})

const formFields = (section: string) =>
  section === 'shows'
    ? ['title', 'slug', 'description', 'content', 'thumbnailUrl', 'bannerImageUrl', 'tags']
    : ['title', 'slug', 'description', 'coverImageUrl', 'curatorId', 'publishedAt']

const emptyForm = (section: string) =>
  Object.fromEntries(formFields(section).map((name) => [name, '']))

const playlistPath = (id: string) => `/api/music/playlists/${encodeURIComponent(id)}`

export class WriteLibrary extends Command.Service<WriteLibrary>()('dashboard/WriteLibrary', {
  args: {
    section: Schema.String,
    action: LibraryAction,
    selected: Schema.NullOr(Schema.String),
    fields: Schema.Record(Schema.String, Schema.String),
    draft: Schema.Boolean,
    trackId: Schema.String,
    trackIds: Schema.Array(Schema.String),
  },
  success: LibraryMessage,
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const service = yield* DashboardService

      return ({ section, action, selected, fields, draft, trackId, trackIds }) =>
        Effect.gen(function* () {
          if (section === 'shows') {
            const path = selected ? `/api/shows/${encodeURIComponent(selected)}` : '/api/shows'

            if (action === 'delete') yield* service.request({ path, method: 'DELETE' })
            else {
              const values = {
                ...fields,
                title: fields.title?.trim(),
                slug: fields.slug?.trim(),
                draft,
                tags: (fields.tags ?? '')
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              }

              const payload = selected
                ? yield* Schema.decodeUnknownEffect(UpdateShowInput)({
                    ...values,
                    expectedRevision: fields.revision ? Number(fields.revision) : undefined,
                  })
                : yield* Schema.decodeUnknownEffect(CreateShowInput)(values)

              yield* service.request({
                path,
                method: selected ? 'PATCH' : 'POST',
                body: JSON.stringify(payload),
              })
            }

            return LibraryMessage.SucceededWrite({
              action,
              selected: null,
              notice: action === 'delete' ? 'Show deleted.' : 'Show saved.',
            })
          }

          const path = selected ? playlistPath(selected) : '/api/music/playlists'
          let result = { ...emptyResult }

          if (action === 'save') {
            const values = {
              title: fields.title?.trim(),
              slug: fields.slug?.trim(),
              description: fields.description?.trim(),
              coverImageUrl: fields.coverImageUrl?.trim(),
              curatorId: fields.curatorId?.trim() || undefined,
              publishedAt: fields.publishedAt?.trim() || undefined,
            }

            const payload = selected
              ? yield* Schema.decodeUnknownEffect(UpdatePlaylistInput)(values)
              : yield* Schema.decodeUnknownEffect(CreatePlaylistInput)(values)

            yield* service.request({
              path,
              method: selected ? 'PATCH' : 'POST',
              body: JSON.stringify(payload),
            })
          } else if (action === 'import' || action === 'add') {
            const resource = action === 'import' ? 'playlist' : 'track'

            const url = yield* Effect.try({
              try: () =>
                new URL((action === 'import' ? fields.importUrl : fields.trackUrl)?.trim() ?? ''),
              catch: () => 'Invalid Spotify URL',
            })

            if (
              url.protocol !== 'https:' ||
              url.hostname !== 'open.spotify.com' ||
              !new RegExp(`^/(?:intl-[^/]+/)?${resource}/[A-Za-z0-9]+/?$`).test(url.pathname)
            )
              return LibraryMessage.FailedWrite({
                message: `Enter an https://open.spotify.com/${resource}/… URL.`,
              })
            result = yield* service.request({
              path:
                action === 'import'
                  ? '/api/music/playlists/import/spotify'
                  : `${path}/tracks/spotify`,
              method: 'POST',
              body: JSON.stringify({ url: url.href }),
            })
          } else if (action === 'remove')
            yield* service.request({
              path: `${path}/tracks/${encodeURIComponent(trackId)}`,
              method: 'DELETE',
            })
          else if (action === 'reorder')
            yield* service.request({
              path: `${path}/tracks/order`,
              method: 'PUT',
              body: JSON.stringify({ trackIds }),
            })
          else if (action === 'sync')
            result = yield* service.request({ path: `${path}/sync-links`, method: 'POST' })
          else yield* service.request({ path, method: 'DELETE' })
          const imported = result.playlistImport
          let notice = 'Playlist changes saved.'

          if (imported)
            notice = `Imported ${imported.trackCount} tracks (${imported.createdTrackCount} new, ${imported.reusedTrackCount} reused). ${imported.enrichmentStatus === 'Accepted' ? 'Link enrichment queued.' : 'Link enrichment unavailable; tracks were imported.'}`
          else if (action === 'sync') notice = 'Link sync accepted for background processing.'
          else if (action === 'delete') notice = 'Playlist deleted.'

          return LibraryMessage.SucceededWrite({
            action,
            selected: imported?.playlistId ?? (action === 'delete' ? null : selected),
            notice,
          })
        }).pipe(
          Effect.catch(() =>
            Effect.succeed(
              LibraryMessage.FailedWrite({
                message:
                  'Could not complete the action. Refresh to check the current state before retrying.',
              }),
            ),
          ),
        )
    }),
  )
}

const emptyResult: DashboardDocument = { rows: [], fields: {}, toggles: {} }

const LibraryDef = Html.component({
  name: 'DashboardLibrary',
  props: Schema.Struct({
    section: Schema.String,
    principal: Principal,
    initialDocument: DashboardDocument,
  }),
  model: Schema.Struct({
    editor: Schema.Boolean,
    selected: Schema.NullOr(Schema.String),
    fields: Schema.Record(Schema.String, Schema.String),
    draft: Schema.Boolean,
    confirming: Schema.Boolean,
    busy: Schema.Boolean,
    operation: Schema.NullOr(Schema.Union([LibraryAction, Schema.Literal('load')])),
    resetForm: Schema.Boolean,
    revision: Schema.Number,
    offset: Schema.Number,
    error: Schema.NullOr(Schema.String),
    notice: Schema.NullOr(Schema.String),
  }),
  message: LibraryMessage,
  restore: (model) => ({
    ...model,
    busy: false,
    operation: null,
    confirming: false,
    error: null,
    resetForm: false,
  }),
  queries: {
    document: {
      query: ReadDashboard,
      args: ({ model, props }) =>
        model.revision > 0
          ? {
              path:
                props.section === 'shows'
                  ? `/api/shows/manage?limit=25&offset=${model.offset}`
                  : '/api/music/playlists',
              principalId: props.principal.id,
              revision: model.revision,
            }
          : undefined,
      onChange: () => LibraryMessage.ChangedDocument(),
    },
    tracks: {
      query: ReadDashboard,
      args: ({ model, props }) =>
        props.section === 'playlists' && model.selected
          ? {
              path: `${playlistPath(model.selected)}/tracks`,
              principalId: props.principal.id,
              revision: model.revision,
            }
          : undefined,
    },
  },
})

export const DashboardLibraryNoDeps = LibraryDef.make({
  init: ($) => ({
    editor: false,
    selected: null,
    fields: emptyForm($.props.section),
    draft: true,
    confirming: false,
    busy: false,
    operation: null,
    resetForm: false,
    revision: 0,
    offset: 0,
    error: null,
    notice: null,
  }),
  update: LibraryDef.update(($, message) => {
    const document = Predicate.isTagged($.queries.document, 'Success')
      ? $.queries.document.value
      : $.props.initialDocument

    const run = (
      action: typeof LibraryAction.Type,
      trackId = '',
      trackIds: ReadonlyArray<string> = [],
    ) => {
      if (
        $.model.busy ||
        $.props.principal.role !== 'admin' ||
        (action === 'delete' && !$.model.confirming)
      )
        return $.model

      if (
        (action === 'remove' || action === 'reorder') &&
        (!Predicate.isTagged($.queries.tracks, 'Success') || $.queries.tracks.waiting)
      )
        return $.model

      if (
        action === 'remove' &&
        Predicate.isTagged($.queries.tracks, 'Success') &&
        !$.queries.tracks.value.playlistTracks?.some((entry) => entry.track.id === trackId)
      )
        return $.model

      if (['add', 'remove', 'reorder', 'sync', 'delete'].includes(action) && !$.model.selected)
        return $.model

      return $.evolve({ busy: true, operation: action, error: null, notice: null }).run(
        WriteLibrary.make({
          section: $.props.section,
          action,
          selected: $.model.selected,
          fields: $.model.fields,
          draft: $.model.draft,
          trackId,
          trackIds,
        }),
      )
    }

    return LibraryMessage.match(message, {
      ClickedNew: () =>
        $.model.busy
          ? $.model
          : $.evolve({
              editor: true,
              selected: null,
              fields: emptyForm($.props.section),
              draft: true,
              confirming: false,
              notice: null,
              error: null,
            }),
      ClickedBack: () =>
        $.model.busy ? $.model : $.evolve({ editor: false, selected: null, confirming: false }),
      UpdatedField: (message) =>
        $.model.busy
          ? $.model
          : $.evolve({ fields: { ...$.model.fields, [message.name]: message.value } }),
      ToggledDraft: () => ($.model.busy ? $.model : $.evolve({ draft: !$.model.draft })),
      ClickedRefresh: (message) =>
        $.model.busy
          ? $.model
          : $.evolve({
              offset: message.offset,
              revision: $.model.revision + 1,
              error: null,
              busy: $.props.section === 'shows',
              operation: $.props.section === 'shows' ? 'load' : null,
            }),
      ChangedDocument: () => {
        const result = $.queries.document

        if (result.waiting) return $.model
        const loadingShows = $.props.section === 'shows' && $.model.operation === 'load'

        if (!Predicate.isTagged(result, 'Success'))
          return loadingShows && Predicate.isTagged(result, 'Failure')
            ? $.evolve({ busy: false, operation: null })
            : $.model

        if (!$.model.resetForm)
          return loadingShows ? $.evolve({ busy: false, operation: null }) : $.model

        const completed = {
          busy: loadingShows ? false : $.model.busy,
          operation: loadingShows ? null : $.model.operation,
          resetForm: false,
        }

        const playlist = result.value.playlists?.find((item) => item.id === $.model.selected)

        if (!playlist)
          return $.evolve({
            ...completed,
            fields: emptyForm($.props.section),
          })

        return $.evolve({
          ...completed,
          fields: {
            title: playlist.title,
            slug: playlist.slug,
            description: playlist.description ?? '',
            coverImageUrl: playlist.coverImageUrl ?? '',
            curatorId: playlist.curatorId ?? '',
            publishedAt: playlist.publishedAt ?? '',
          },
        })
      },
      ClickedDelete: () => ($.model.busy ? $.model : $.evolve({ confirming: true })),
      ClickedCancelDelete: () => ($.model.busy ? $.model : $.evolve({ confirming: false })),
      ClickedEdit: (message) => {
        if ($.model.busy) return $.model

        if ($.props.section === 'shows') {
          const show = document.shows?.data.find((item) => item.slug === message.id)

          if (!show) return $.model

          return $.evolve({
            editor: true,
            selected: show.slug,
            draft: show.draft,
            confirming: false,
            fields: {
              title: show.title,
              slug: show.slug,
              description: show.description ?? '',
              content: show.content,
              thumbnailUrl: show.thumbnailUrl ?? '',
              bannerImageUrl: show.bannerImageUrl ?? '',
              tags: show.tags?.join(', ') ?? '',
              revision: show.revision === undefined ? '' : String(show.revision),
            },
          })
        }

        const playlist = document.playlists?.find((item) => item.id === message.id)

        if (!playlist) return $.model

        return $.evolve({
          editor: true,
          selected: playlist.id,
          confirming: false,
          fields: {
            title: playlist.title,
            slug: playlist.slug,
            description: playlist.description ?? '',
            coverImageUrl: playlist.coverImageUrl ?? '',
            curatorId: playlist.curatorId ?? '',
            publishedAt: playlist.publishedAt ?? '',
          },
        })
      },

      ClickedAction: (message) => run(message.action, message.trackId),
      ClickedMove: (message) => {
        if (!Predicate.isTagged($.queries.tracks, 'Success')) return $.model
        const ids = ($.queries.tracks.value.playlistTracks ?? []).map((entry) => entry.track.id)
        const from = ids.indexOf(message.id)
        const to = from + (message.direction === 'up' ? -1 : 1)

        if (from < 0 || to < 0 || to >= ids.length) return $.model
        const moved = ids[from]
        const other = ids[to]

        if (!moved || !other) return $.model
        ids[from] = other
        ids[to] = moved

        return run('reorder', '', ids)
      },

      SucceededWrite: (message) =>
        $.evolve({
          busy: $.props.section === 'shows',
          operation: $.props.section === 'shows' ? 'load' : null,
          revision: $.model.revision + 1,
          selected: message.selected,
          confirming: false,
          notice: message.notice,
          fields: { ...$.model.fields, trackUrl: '', importUrl: '' },
          resetForm: ['save', 'import', 'delete'].includes(message.action),
          editor: message.selected !== null && $.props.section === 'playlists',
        }),
      FailedWrite: (message) => $.evolve({ busy: false, operation: null, error: message.message }),
    })
  }),
  view: (h, model) => {
    const document = Predicate.isTagged(h.queries.document, 'Success')
      ? h.queries.document.value
      : h.props.initialDocument

    const field = (name: string) => {
      const label = name.replace(/([A-Z])/g, ' $1')

      if (['description', 'content'].includes(name))
        return h.label.children(
          label,
          h.textarea
            .disabled(model.busy)
            .attr('rows', '5')
            .value(model.fields[name] ?? '')
            .on('input', ({ value }) => LibraryMessage.UpdatedField({ name, value })),
        )

      return Field(
        h,
        name,
        label,
        model.fields[name] ?? '',
        (value) => LibraryMessage.UpdatedField({ name, value }),
        'text',
        model.busy,
      )
    }

    const action = (value: typeof LibraryAction.Type, label: string, trackId = '') =>
      h.button
        .disabled(model.busy)
        .on('click', LibraryMessage.ClickedAction({ action: value, trackId }))
        .children(label)

    const tracks = Predicate.isTagged(h.queries.tracks, 'Success')
      ? (h.queries.tracks.value.playlistTracks ?? [])
      : []

    const saveLabel = () => {
      if (model.operation === 'save') return 'Saving'

      if (model.selected) return 'Save changes'

      return h.props.section === 'shows' ? 'Create show' : 'Create playlist'
    }

    return h.section.class('admin-page').children(
      Notice(h, model.error, true),
      Notice(h, model.notice),
      Predicate.isTagged(h.queries.document, 'Failure') ||
        Predicate.isTagged(h.queries.tracks, 'Failure')
        ? h.p
            .attr('role', 'alert')
            .children('Could not refresh the current library data. Try again before editing.')
        : undefined,
      h.button
        .disabled(model.busy)
        .on('click', LibraryMessage.ClickedRefresh({ offset: model.offset }))
        .children('Refresh'),
      model.editor
        ? [
            h.button
              .disabled(model.busy)
              .on('click', LibraryMessage.ClickedBack())
              .children('Back to list'),
            h.div
              .class('dashboard-form')
              .children(
                formFields(h.props.section).map(field),
                h.props.section === 'shows'
                  ? h.label.children(
                      h.input
                        .attr('type', 'checkbox')
                        .disabled(model.busy)
                        .checked(model.draft)
                        .on('click', LibraryMessage.ToggledDraft()),
                      'Draft',
                    )
                  : undefined,
                action('save', saveLabel()),
              ),
            model.selected
              ? h.div.children(
                  h.button
                    .disabled(model.busy)
                    .on('click', LibraryMessage.ClickedDelete())
                    .children('Delete'),
                  model.confirming
                    ? h.div.children(
                        h.p('Permanently delete this item?'),
                        action('delete', 'Confirm delete'),
                        h.button
                          .disabled(model.busy)
                          .on('click', LibraryMessage.ClickedCancelDelete())
                          .children('Cancel'),
                      )
                    : undefined,
                )
              : undefined,
            h.props.section === 'playlists' && model.selected
              ? h.div.children(
                  h.h2('Tracks'),
                  field('trackUrl'),
                  action('add', 'Add Spotify track'),
                  action('sync', 'Sync source links'),
                  h.ol.children(
                    tracks.map((entry, index) =>
                      h.li.key(entry.track.id).children(
                        h.span(entry.track.title),
                        h.button
                          .disabled(model.busy || index === 0)
                          .on(
                            'click',
                            LibraryMessage.ClickedMove({ id: entry.track.id, direction: 'up' }),
                          )
                          .children('Move up'),
                        h.button
                          .disabled(model.busy || index === tracks.length - 1)
                          .on(
                            'click',
                            LibraryMessage.ClickedMove({ id: entry.track.id, direction: 'down' }),
                          )
                          .children('Move down'),
                        action('remove', 'Remove track', entry.track.id),
                      ),
                    ),
                  ),
                )
              : undefined,
          ]
        : [
            h.button
              .disabled(model.busy)
              .on('click', LibraryMessage.ClickedNew())
              .children(h.props.section === 'shows' ? 'New show' : 'New playlist'),
            h.props.section === 'shows'
              ? h.ul.children(
                  document.shows?.data.map((show) =>
                    h.li.key(show.id).children(
                      h.a
                        .attr('href', `/shows/${encodeURIComponent(show.slug)}`)
                        .children(show.title),
                      h.span(show.draft ? 'Draft' : 'Published'),
                      h.button
                        .disabled(model.busy)
                        .on('click', LibraryMessage.ClickedEdit({ id: show.slug }))
                        .children('Edit'),
                    ),
                  ),
                )
              : h.ul.children(
                  document.playlists?.map((playlist) =>
                    h.li
                      .key(playlist.id)
                      .children(
                        h.a
                          .attr('href', `/music/playlists/${encodeURIComponent(playlist.slug)}`)
                          .children(playlist.title),
                        h.span(playlist.publishedAt ? 'Published' : 'Draft'),
                        h.button
                          .on('click', LibraryMessage.ClickedEdit({ id: playlist.id }))
                          .children('Edit'),
                      ),
                  ),
                ),
            h.props.section === 'playlists'
              ? h.div
                  .class('dashboard-form')
                  .children(field('importUrl'), action('import', 'Import Spotify playlist'))
              : undefined,
          ],
      document.shows
        ? h.nav.attr('aria-label', 'Show pages').children(
            h.button
              .disabled(model.busy || model.offset === 0)
              .on(
                'click',
                LibraryMessage.ClickedRefresh({ offset: Math.max(0, model.offset - 25) }),
              )
              .children('Previous'),
            h.span(plural(document.shows.pagination.total, 'show')),
            h.button
              .disabled(model.busy || !document.shows.pagination.hasMore)
              .on('click', LibraryMessage.ClickedRefresh({ offset: model.offset + 25 }))
              .children('Next'),
          )
        : undefined,
    )
  },
})

export const DashboardLibrary = DashboardLibraryNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(ReadDashboard.layer, WriteLibrary.layer).pipe(
      Layer.provide(DashboardServiceLive),
    ),
  ),
)
