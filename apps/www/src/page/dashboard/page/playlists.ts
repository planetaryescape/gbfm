import {
  CreatePlaylistInput,
  PlaylistListResponse,
  type PlaylistResponse,
  PlaylistTrackEntry,
  UpdatePlaylistInput,
} from '@gbfm/api/music'
import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'

import { DashboardRequestError, DashboardService, type DashboardRequest } from '../service'
import { dataTable, drawer, emptyState, frame, pageHeader, pager, plural } from '../ui'

const fields = [
  'title',
  'slug',
  'description',
  'coverImageUrl',
  'curatorId',
  'publishedAt',
] as const

const Field = Schema.Literals(fields)

const Form = Schema.Struct({
  title: Schema.String,
  slug: Schema.String,
  description: Schema.String,
  coverImageUrl: Schema.String,
  curatorId: Schema.String,
  publishedAt: Schema.String,
})

const emptyForm: typeof Form.Type = {
  title: '',
  slug: '',
  description: '',
  coverImageUrl: '',
  curatorId: '',
  publishedAt: '',
}

const Tracks = Schema.Array(PlaylistTrackEntry)

const Editor = Schema.TaggedUnion({
  Listing: {},
  Creating: {},
  Editing: { id: Schema.String },
})

const Action = Schema.Literals(['save', 'delete', 'import', 'add', 'remove', 'reorder', 'sync'])

const busy = (model: Model) => model.operation !== 'idle'

const selectedId = (model: Model) => (Editor.guards.Editing(model.editor) ? model.editor.id : null)

export const Model = Schema.Struct({
  listing: PlaylistListResponse,
  editor: Editor,
  form: Form,
  tracks: Tracks,
  importUrl: Schema.String,
  trackUrl: Schema.String,
  operation: Schema.Union([Schema.Literals(['idle', 'loading']), Action]),
  deleting: Schema.Boolean,
  error: Schema.NullOr(Schema.String),
  notice: Schema.String,
})

export type Model = typeof Model.Type

export const initialModel: Model = {
  listing: [],
  editor: Editor.cases.Listing.make({}),
  form: emptyForm,
  tracks: [],
  importUrl: '',
  trackUrl: '',
  operation: 'idle',
  deleting: false,
  error: null,
  notice: '',
}

export const Message = defineMessageUnion({
  FieldChanged: { field: Field, value: Schema.String },
  ImportUrlChanged: { value: Schema.String },
  TrackUrlChanged: { value: Schema.String },
  Select: { id: Schema.String },
  New: {},
  Back: {},
  Save: {},
  Import: {},
  AddTrack: {},
  RemoveTrack: { id: Schema.String },
  MoveTrack: { id: Schema.String, direction: Schema.Literals(['up', 'down']) },
  Sync: {},
  AskDelete: {},
  CancelDelete: {},
  ConfirmDelete: {},
  Loaded: { listing: PlaylistListResponse, tracks: Tracks, resetForm: Schema.Boolean },
  Saved: {
    selected: Schema.NullOr(Schema.String),
    notice: Schema.String,
    resetForm: Schema.Boolean,
  },
  Failed: { message: Schema.String },
})

export type Message = typeof Message.Type

type Result = Update.Return<Model, Message, DashboardService>

const pathFor = (id: string) => `/api/music/playlists/${encodeURIComponent(id)}`

const formFor = (playlist: PlaylistResponse): typeof Form.Type => ({
  title: playlist.title,
  slug: playlist.slug,
  description: playlist.description ?? '',
  coverImageUrl: playlist.coverImageUrl ?? '',
  curatorId: playlist.curatorId ?? '',
  publishedAt: playlist.publishedAt ?? '',
})

const Load = Command.define('Playlists.Load', {
  args: { selected: Schema.NullOr(Schema.String), resetForm: Schema.Boolean },
  messages: [Message.Loaded, Message.Failed],
  execute: ({ selected, resetForm }) =>
    Effect.gen(function* () {
      const service = yield* DashboardService
      const listing = yield* service.request({ path: '/api/music/playlists' })

      const tracks = selected
        ? yield* service.request({ path: `${pathFor(selected)}/tracks` })
        : null

      return Message.Loaded({
        listing: listing.playlists ?? [],
        tracks: tracks?.playlistTracks ?? [],
        resetForm,
      })
    }).pipe(Effect.catch((error) => Effect.succeed(Message.Failed({ message: error.message })))),
})

const Write = Command.define('Playlists.Write', {
  args: {
    action: Action,
    selected: Schema.NullOr(Schema.String),
    form: Form,
    url: Schema.String,
    trackId: Schema.String,
    trackIds: Schema.Array(Schema.String),
  },
  messages: [Message.Saved, Message.Failed],
  execute: ({ action, selected, form, url, trackId, trackIds }) =>
    Effect.gen(function* () {
      const service = yield* DashboardService
      const path = selected ? pathFor(selected) : '/api/music/playlists'
      let request: DashboardRequest

      if (action === 'save') {
        const values = {
          title: form.title.trim(),
          slug: form.slug.trim(),
          description: form.description.trim(),
          coverImageUrl: form.coverImageUrl.trim(),
          curatorId: form.curatorId.trim() || undefined,
          publishedAt: form.publishedAt.trim() || undefined,
        }

        const payload = selected
          ? yield* Schema.decodeUnknownEffect(UpdatePlaylistInput)(values)
          : yield* Schema.decodeUnknownEffect(CreatePlaylistInput)(values)

        request = { path, method: selected ? 'PATCH' : 'POST', body: JSON.stringify(payload) }
      } else if (action === 'import' || action === 'add') {
        const resource = action === 'import' ? 'playlist' : 'track'

        const parsed = yield* Effect.try({
          try: () => new URL(url.trim()),
          catch: () => new DashboardRequestError({ status: null, message: 'Enter a Spotify URL.' }),
        })

        if (
          parsed.protocol !== 'https:' ||
          parsed.hostname !== 'open.spotify.com' ||
          !new RegExp(`^/(?:intl-[^/]+/)?${resource}/[A-Za-z0-9]+/?$`).test(parsed.pathname)
        )
          return Message.Failed({ message: `Enter an https://open.spotify.com/${resource}/… URL.` })
        request = {
          path:
            action === 'import' ? '/api/music/playlists/import/spotify' : `${path}/tracks/spotify`,
          method: 'POST',
          body: JSON.stringify({ url: parsed.href }),
        }
      } else if (action === 'reorder')
        request = {
          path: `${path}/tracks/order`,
          method: 'PUT',
          body: JSON.stringify({ trackIds }),
        }
      else if (action === 'remove')
        request = { path: `${path}/tracks/${encodeURIComponent(trackId)}`, method: 'DELETE' }
      else if (action === 'sync') request = { path: `${path}/sync-links`, method: 'POST' }
      else request = { path, method: 'DELETE' }

      const result = yield* service.request(request)
      const imported = result.playlistImport

      const notice = imported
        ? `Imported ${imported.trackCount} tracks (${imported.createdTrackCount} new, ${imported.reusedTrackCount} reused). ${imported.enrichmentStatus === 'Accepted' ? 'Link enrichment queued.' : 'Link enrichment unavailable; tracks were imported.'}`
        : action === 'sync'
          ? 'Link sync accepted for background processing.'
          : action === 'delete'
            ? 'Playlist deleted.'
            : 'Playlist changes saved.'

      return Message.Saved({
        selected: imported?.playlistId ?? (action === 'delete' ? null : selected),
        notice,
        resetForm: action === 'save' || action === 'import' || action === 'delete',
      })
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(
          Message.Failed({
            message:
              'Playlist action failed. Check the fields, provider availability and your access, then retry.',
          }),
        ),
      ),
    ),
})

const write = (
  model: Model,
  action: typeof Action.Type,
  trackId = '',
  trackIds: ReadonlyArray<string> = [],
): Result => {
  if (busy(model) || (!selectedId(model) && action !== 'save' && action !== 'import'))
    return { model }

  return {
    model: { ...model, operation: action, error: null, notice: '' },
    commands: [
      Write({
        action,
        selected: selectedId(model),
        form: model.form,
        url: action === 'import' ? model.importUrl : model.trackUrl,
        trackId,
        trackIds,
      }),
    ],
  }
}

export const update = (model: Model, message: Message): Result =>
  Message.match<Result>(message, {
    FieldChanged: ({ field, value }) =>
      busy(model) ? { model } : { model: { ...model, form: { ...model.form, [field]: value } } },
    ImportUrlChanged: ({ value }) =>
      busy(model) ? { model } : { model: { ...model, importUrl: value } },
    TrackUrlChanged: ({ value }) =>
      busy(model) ? { model } : { model: { ...model, trackUrl: value } },
    New: () =>
      busy(model)
        ? { model }
        : {
            model: {
              ...initialModel,
              listing: model.listing,
              editor: Editor.cases.Creating.make({}),
            },
          },
    Back: () => (busy(model) ? { model } : { model: { ...initialModel, listing: model.listing } }),
    Select: ({ id }) => {
      const playlist = model.listing.find((item) => item.id === id)

      if (busy(model) || !playlist) return { model }

      return {
        model: {
          ...model,
          editor: Editor.cases.Editing.make({ id }),
          form: formFor(playlist),
          tracks: [],
          operation: 'loading',
          error: null,
          notice: '',
          deleting: false,
        },
        commands: [Load({ selected: id, resetForm: true })],
      }
    },
    Save: () => write(model, 'save'),
    Import: () => write(model, 'import'),
    AddTrack: () => write(model, 'add'),
    Sync: () => write(model, 'sync'),
    RemoveTrack: ({ id }) =>
      model.tracks.some((row) => row.track.id === id) ? write(model, 'remove', id) : { model },
    MoveTrack: ({ id, direction }) => {
      const ids = model.tracks.map((row) => row.track.id)
      const index = ids.indexOf(id)
      const target = index + (direction === 'up' ? -1 : 1)

      if (index < 0 || target < 0 || target >= ids.length) return { model }
      ids.splice(index, 1)
      ids.splice(target, 0, id)

      return write(model, 'reorder', '', ids)
    },
    AskDelete: () =>
      busy(model) || !selectedId(model) ? { model } : { model: { ...model, deleting: true } },
    CancelDelete: () => (busy(model) ? { model } : { model: { ...model, deleting: false } }),
    ConfirmDelete: () => (model.deleting ? write(model, 'delete') : { model }),
    Loaded: ({ listing, tracks, resetForm }) => {
      const playlist = listing.find((item) => item.id === selectedId(model))

      const form = resetForm ? (playlist ? formFor(playlist) : emptyForm) : model.form

      return { model: { ...model, listing, tracks, form, operation: 'idle', error: null } }
    },
    Saved: ({ selected, notice, resetForm }) => ({
      model: {
        ...model,
        editor: selected
          ? Editor.cases.Editing.make({ id: selected })
          : Editor.cases.Listing.make({}),
        notice,
        deleting: false,
        trackUrl: '',
        importUrl: '',
        operation: 'loading',
      },
      commands: [Load({ selected, resetForm })],
    }),
    Failed: ({ message }) => ({ model: { ...model, operation: 'idle', error: message } }),
  })

const labels = {
  title: 'Playlist title',
  slug: 'Playlist slug',
  description: 'Description',
  coverImageUrl: 'Cover image URL',
  curatorId: 'Curator ID',
  publishedAt: 'Published at',
}

const notices = (model: Model, h: HtmlBuilder<Message>) => [
  model.error ? h.p([h.Role('alert'), h.Class('admin-notice')], [model.error]) : h.empty,
  model.notice ? h.p([h.Role('status'), h.Class('admin-notice')], [model.notice]) : h.empty,
]

const listView = (model: Model, h: HtmlBuilder<Message>) =>
  h.section(
    [h.Class('admin-page')],
    [
      pageHeader(h, 'Curated playlists built from catalog tracks.', [
        drawer(
          h,
          'Import from Spotify',
          [
            h.form(
              [h.Class('admin-inline-form admin-import'), h.OnSubmit(Message.Import())],
              [
                h.input([
                  h.Type('url'),
                  h.Required(true),
                  h.AriaLabel('Spotify playlist URL'),
                  h.Placeholder('https://open.spotify.com/playlist/...'),
                  h.Value(model.importUrl),
                  h.Disabled(busy(model)),
                  h.OnInput((value) => Message.ImportUrlChanged({ value })),
                ]),
                h.button([h.Type('submit'), h.Disabled(busy(model))], ['Import playlist']),
              ],
            ),
          ],
          false,
        ),
        h.button(
          [
            h.Type('button'),
            h.Class('dashboard-button-primary'),
            h.Disabled(busy(model)),
            h.OnClick(Message.New()),
          ],
          ['New playlist'],
        ),
      ]),
      ...notices(model, h),
      frame(h, [
        dataTable(h, {
          label: 'Playlists',
          minWidth: '30rem',
          columns: [
            { label: 'Title' },
            { label: 'Slug', className: 'admin-col-mono', width: '40%' },
            { label: '', className: 'admin-col-actions', width: '5rem' },
          ],
          rows: model.listing.map((item) => ({
            key: item.id,
            cells: [
              h.strong([], [item.title]),
              item.slug,
              h.button(
                [h.Disabled(busy(model)), h.OnClick(Message.Select({ id: item.id }))],
                ['Edit'],
              ),
            ],
          })),
          empty: emptyState(h, 'No playlists yet. Create one or import from Spotify.'),
        }),
        model.listing.length
          ? pager(h, {
              label: 'Playlist count',
              summary: plural(model.listing.length, 'playlist'),
              previous: null,
              next: null,
            })
          : h.empty,
      ]),
    ],
  )

const playlistForm = (model: Model, h: HtmlBuilder<Message>) =>
  h.form(
    [h.Class('dashboard-panel dashboard-form admin-form-grid'), h.OnSubmit(Message.Save())],
    [
      ...fields.map((field) =>
        h.label(field === 'description' ? [h.Class('admin-form-wide')] : [], [
          labels[field],
          field === 'description'
            ? h.textarea([
                h.Value(model.form[field]),
                h.Disabled(busy(model)),
                h.Rows(3),
                h.OnInput((value) => Message.FieldChanged({ field, value })),
              ])
            : h.input([
                h.Value(model.form[field]),
                h.Disabled(busy(model)),
                h.Required(field === 'title' || field === 'slug'),
                h.OnInput((value) => Message.FieldChanged({ field, value })),
              ]),
        ]),
      ),
      h.div(
        [h.Class('admin-form-actions')],
        [
          h.button(
            [h.Type('submit'), h.Class('dashboard-button-primary'), h.Disabled(busy(model))],
            [selectedId(model) ? 'Save playlist' : 'Create playlist'],
          ),
        ],
      ),
    ],
  )

const tracksView = (model: Model, h: HtmlBuilder<Message>) =>
  frame(h, [
    h.form(
      [h.OnSubmit(Message.AddTrack()), h.Class('admin-toolbar')],
      [
        h.input([
          h.Type('url'),
          h.Required(true),
          h.AriaLabel('Spotify track URL'),
          h.Placeholder('Add a Spotify track URL'),
          h.Value(model.trackUrl),
          h.Disabled(busy(model)),
          h.OnInput((value) => Message.TrackUrlChanged({ value })),
        ]),
        h.button([h.Type('submit'), h.Disabled(busy(model))], ['Add Spotify track']),
      ],
    ),
    dataTable(h, {
      label: 'Playlist tracks',
      minWidth: '32rem',
      columns: [
        { label: '#', className: 'admin-col-muted', width: '3rem' },
        { label: 'Title' },
        { label: 'Artists', className: 'admin-col-muted', width: '35%' },
        { label: '', className: 'admin-col-actions', width: '10.5rem' },
      ],
      rows: model.tracks.map((row, index) => ({
        key: row.track.id,
        cells: [
          String(index + 1),
          row.track.title,
          row.track.artistNames?.join(', ') ?? '',
          h.div(
            [h.Class('admin-actions')],
            [
              h.button(
                [
                  h.Disabled(busy(model) || index === 0),
                  h.AriaLabel(`Move ${row.track.title} up`),
                  h.Title('Move up'),
                  h.OnClick(Message.MoveTrack({ id: row.track.id, direction: 'up' })),
                ],
                ['↑'],
              ),
              h.button(
                [
                  h.Disabled(busy(model) || index === model.tracks.length - 1),
                  h.AriaLabel(`Move ${row.track.title} down`),
                  h.Title('Move down'),
                  h.OnClick(Message.MoveTrack({ id: row.track.id, direction: 'down' })),
                ],
                ['↓'],
              ),
              h.button(
                [
                  h.Disabled(busy(model)),
                  h.AriaLabel(`Remove ${row.track.title}`),
                  h.OnClick(Message.RemoveTrack({ id: row.track.id })),
                ],
                ['Remove'],
              ),
            ],
          ),
        ],
      })),
      empty: emptyState(h, 'No tracks yet.'),
    }),
    h.div(
      [h.Class('admin-pager')],
      [
        h.button(
          [h.Class('admin-button-small'), h.Disabled(busy(model)), h.OnClick(Message.Sync())],
          ['Sync track links'],
        ),
        h.button(
          [h.Class('admin-button-small'), h.Disabled(busy(model)), h.OnClick(Message.AskDelete())],
          ['Delete playlist'],
        ),
      ],
    ),
    model.deleting
      ? h.div(
          [h.Class('admin-confirm admin-pager'), h.Role('alert')],
          [
            h.p([], ['Permanently delete this playlist? Tracks remain in the music catalog.']),
            h.button(
              [h.Disabled(busy(model)), h.OnClick(Message.ConfirmDelete())],
              ['Confirm delete playlist'],
            ),
            h.button(
              [h.Disabled(busy(model)), h.OnClick(Message.CancelDelete())],
              ['Keep playlist'],
            ),
          ],
        )
      : h.empty,
  ])

const detailView = (model: Model, h: HtmlBuilder<Message>) =>
  h.section(
    [h.Class('admin-page')],
    [
      h.div(
        [h.Class('admin-detail-head')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('admin-button-small'),
              h.Disabled(busy(model)),
              h.OnClick(Message.Back()),
            ],
            ['Back to playlists'],
          ),
          h.h2(
            [h.Class('admin-detail-title')],
            [selectedId(model) ? model.form.title || 'Edit playlist' : 'New playlist'],
          ),
        ],
      ),
      ...notices(model, h),
      playlistForm(model, h),
      selectedId(model) ? tracksView(model, h) : h.empty,
    ],
  )

export const view = defineView<Model, Message>((model, h) =>
  !Editor.guards.Listing(model.editor) ? detailView(model, h) : listView(model, h),
)
