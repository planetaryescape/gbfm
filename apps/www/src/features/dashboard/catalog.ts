import { Command, Component, Mount, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import {
  AddEntityLinkInput,
  CreateLabelInput,
  MusicRevision,
  MusicReferenceRevision,
  MusicWriteIntent,
  UpdateAlbumInput,
  UpdateArtistInput,
  UpdateLabelInput,
  UpdateTrackInput,
} from '@gbfm/api/music'
import { Effect, Layer, Match, Predicate, Schema } from 'effect'

import { Principal } from '../../domain/principal'
import { DashboardDocument } from './document'
import { DataTable, Field, Notice } from './presentation'
import { endpointFor, entityRoute } from './sections'
import {
  DashboardRequestError,
  DashboardService,
  DashboardServiceLive,
  ReadDashboard,
} from './service'

const Kind = Schema.Literals(['artist', 'album', 'track', 'label'])

type Kind = typeof Kind.Type

const fieldsFor = (kind: string): ReadonlyArray<string> => {
  switch (kind) {
    case 'artist':
      return ['name', 'slug', 'bio', 'imageUrl', 'genres', 'publishedAt']
    case 'album':
      return [
        'title',
        'slug',
        'artistNames',
        'releaseDate',
        'coverImageUrl',
        'genres',
        'albumType',
        'publishedAt',
      ]
    case 'track':
      return [
        'title',
        'slug',
        'artistNames',
        'coverImageUrl',
        'albumId',
        'trackNumber',
        'publishedAt',
      ]
    default:
      return [
        'name',
        'slug',
        'description',
        'imageUrl',
        'bannerImageUrl',
        'content',
        'tags',
        'genres',
        'publishedAt',
      ]
  }
}

const catalogPayload = (kind: Kind, fields: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const trackNumber =
      kind === 'track' && fields.trackNumber?.trim()
        ? yield* Schema.decodeUnknownEffect(
            Schema.NumberFromString.pipe(Schema.check(Schema.isFinite())),
          )(fields.trackNumber.trim())
        : null

    const payload = Object.fromEntries(
      fieldsFor(kind).map((key) => {
        const value = fields[key]?.trim() ?? ''

        if (['genres', 'artistNames', 'tags'].includes(key))
          return [
            key,
            value
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
          ]

        if (key === 'trackNumber') return [key, trackNumber]

        return [key, kind === 'artist' ? value : value || null]
      }),
    )

    return yield* Match.value(kind).pipe(
      Match.when('artist', () => Schema.decodeUnknownEffect(UpdateArtistInput)(payload)),
      Match.when('album', () => Schema.decodeUnknownEffect(UpdateAlbumInput)(payload)),
      Match.when('track', () => Schema.decodeUnknownEffect(UpdateTrackInput)(payload)),
      Match.when('label', () => Schema.decodeUnknownEffect(UpdateLabelInput)(payload)),
      Match.exhaustive,
    )
  })

const CatalogAction = Schema.Literals(['save', 'delete', 'add-link', 'remove-link', 'create-label'])

const CatalogWriteRequest = Schema.Struct({
  action: CatalogAction,
  kind: Kind,
  id: Schema.String,
  fields: Schema.Record(Schema.String, Schema.String),
  linkId: Schema.String,
  expectedRevision: Schema.NullOr(MusicRevision),
  requestId: Schema.NullOr(MusicWriteIntent.fields.requestId),
  references: Schema.Array(MusicReferenceRevision),
})

export const CatalogMessage = UiSchema.TaggedEnum({
  UpdatedField: { name: Schema.String, value: Schema.String },
  ClickedAction: { action: CatalogAction, linkId: Schema.String },
  ClickedDelete: {},
  ClickedCancelDelete: {},
  ClickedRefresh: {},
  ChangedDocument: {},
  SucceededWrite: { action: CatalogAction },
  FailedWrite: { message: Schema.String, pending: CatalogWriteRequest, uncertain: Schema.Boolean },
})

const StartCatalogQueries = Mount.make('StartCatalogQueries', { args: {} }, () =>
  Effect.succeed(CatalogMessage.ClickedRefresh()),
)

export const catalogWriter = Effect.gen(function* () {
  const service = yield* DashboardService

  return (request: typeof CatalogWriteRequest.Type) =>
    Effect.gen(function* () {
      const requestId = request.requestId ?? (yield* Effect.sync(() => crypto.randomUUID()))
      const pending = { ...request, requestId }
      const { action, kind, id, fields, linkId, expectedRevision, references } = pending

      return yield* Effect.gen(function* () {
        const path = `/api/music/${kind}s/${encodeURIComponent(id)}`
        const links = `/api/music/${kind}/${encodeURIComponent(id)}/links`

        if (action === 'save') {
          const payload = yield* catalogPayload(kind, fields)

          const intent = yield* Schema.decodeUnknownEffect(MusicWriteIntent)({
            requestId,
            expectedRevision,
          })

          yield* service.request({
            path,
            method: 'PATCH',
            body: JSON.stringify({ ...payload, ...intent, references }),
          })
        } else if (action === 'delete') {
          const intent = yield* Schema.decodeUnknownEffect(MusicWriteIntent)({
            requestId,
            expectedRevision,
          })

          yield* service.request({
            path,
            method: 'DELETE',
            headers: {
              'x-gbfm-music-revision': String(intent.expectedRevision),
              'x-gbfm-request-id': intent.requestId,
            },
          })
        } else if (action === 'remove-link')
          yield* service.request({
            path: `${links}/${encodeURIComponent(linkId)}`,
            method: 'DELETE',
          })
        else if (action === 'add-link') {
          const payload = yield* Schema.decodeUnknownEffect(AddEntityLinkInput)({
            platform: fields.platform || 'spotify',
            url: fields.linkUrl,
            status: 'verified',
          })

          yield* service.request({ path: links, method: 'POST', body: JSON.stringify(payload) })
        } else {
          const payload = yield* Schema.decodeUnknownEffect(CreateLabelInput)({
            name: fields.name?.trim(),
            slug: fields.slug?.trim(),
            content: '',
          })

          yield* service.request({
            path: '/api/music/labels',
            method: 'POST',
            body: JSON.stringify(payload),
          })
        }

        return CatalogMessage.SucceededWrite({ action })
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(
            CatalogMessage.FailedWrite({
              message:
                'Catalogue action failed. Check the fields, current revision and your access before retrying.',
              pending,
              uncertain:
                error instanceof DashboardRequestError &&
                (error.status === null || error.status === 408 || error.status >= 500),
            }),
          ),
        ),
      )
    })
})

export class WriteCatalog extends Command.Service<WriteCatalog>()('dashboard/WriteCatalog', {
  args: CatalogWriteRequest,
  success: CatalogMessage,
}) {
  static readonly layer = this.toLayer(catalogWriter)
}

const CatalogDef = Html.component({
  name: 'DashboardCatalog',
  props: Schema.Struct({
    section: Schema.String,
    principal: Principal,
    initialDocument: DashboardDocument,
    url: Schema.String,
  }),
  model: Schema.Struct({
    fields: Schema.Record(Schema.String, Schema.String),
    revision: Schema.Number,
    busy: Schema.Boolean,
    refreshing: Schema.Boolean,
    pending: Schema.NullOr(CatalogWriteRequest),
    resetFields: Schema.Boolean,
    confirming: Schema.Boolean,
    deleted: Schema.Boolean,
    error: Schema.NullOr(Schema.String),
    notice: Schema.NullOr(Schema.String),
  }),
  message: CatalogMessage,
  restore: false,
  queries: {
    document: {
      query: ReadDashboard,
      args: ({ model, props }) => {
        const path = endpointFor(props.section, new URL(props.url, 'http://localhost').searchParams)

        return path && model.revision > 0 && !model.deleted
          ? { path, principalId: props.principal.id, revision: model.revision }
          : undefined
      },
      onChange: () => CatalogMessage.ChangedDocument(),
    },
    links: {
      query: ReadDashboard,
      args: ({ model, props }) => {
        const entity = entityRoute(props.section)

        return entity && !model.deleted && model.revision > 0
          ? {
              path: `/api/music/${entity.kind}/${encodeURIComponent(entity.id)}/links`,
              principalId: props.principal.id,
              revision: model.revision,
            }
          : undefined
      },
    },
    album: {
      query: ReadDashboard,
      debounce: '300 millis',
      args: ({ model, props }) => {
        const entity = entityRoute(props.section)
        const id = model.fields.albumId?.trim()

        return entity?.kind === 'track' && id && model.revision > 0 && !model.deleted
          ? {
              path: `/api/music/albums/${encodeURIComponent(id)}`,
              principalId: props.principal.id,
              revision: model.revision,
            }
          : undefined
      },
    },
  },
})

export const DashboardCatalogNoDeps = CatalogDef.make({
  init: ($) => ({
    fields: $.props.initialDocument.fields,
    revision: 0,
    busy: false,
    refreshing: false,
    pending: null,
    resetFields: false,
    confirming: false,
    deleted: false,
    error: null,
    notice: null,
  }),
  update: {
    UpdatedField: ($, { name, value }) =>
      $.model.busy || $.model.refreshing || $.model.pending
        ? $.model
        : $.evolve({ fields: { ...$.model.fields, [name]: value } }),
    ClickedDelete: ($) => ($.model.busy ? $.model : $.evolve({ confirming: true })),
    ClickedCancelDelete: ($) => ($.model.busy ? $.model : $.evolve({ confirming: false })),
    ClickedRefresh: ($) =>
      $.model.busy
        ? $.model
        : $.evolve({
            revision: $.model.revision + 1,
            error: null,
            refreshing: true,
            pending: null,
            resetFields: true,
          }),
    ChangedDocument: ($) => {
      const result = $.queries.document

      if (result.waiting || $.model.busy || $.model.pending) return $.model

      if (Predicate.isTagged(result, 'Failure'))
        return $.evolve({
          refreshing: false,
          error: 'Could not refresh the catalogue. Try again before editing.',
        })

      if (!Predicate.isTagged(result, 'Success')) return $.model

      return $.evolve({
        refreshing: false,
        resetFields: false,
        fields: $.model.resetFields ? result.value.fields : $.model.fields,
      })
    },
    ClickedAction: ($, { action, linkId }) => {
      const entity = entityRoute($.props.section)

      if (
        $.model.busy ||
        $.model.refreshing ||
        $.props.principal.role !== 'admin' ||
        $.model.deleted ||
        (action === 'delete' && !$.model.confirming) ||
        (entity && $.model.fields.id !== entity.id) ||
        (!entity && action !== 'create-label')
      )
        return $.model

      if (
        action === 'remove-link' &&
        (!Predicate.isTagged($.queries.links, 'Success') ||
          !$.queries.links.value.rows.some((row) => row.id === linkId))
      )
        return $.model
      const kind = Schema.decodeUnknownSync(Kind)(entity?.kind ?? 'label')

      if (
        $.model.pending &&
        ($.model.pending.action !== action || $.model.pending.linkId !== linkId)
      )
        return $.model
      const expectedRevision = Number($.model.fields.revision)

      if ((action === 'save' || action === 'delete') && !Schema.is(MusicRevision)(expectedRevision))
        return $.evolve({ error: 'Refresh to observe the current music revision before editing.' })

      const references: Array<typeof MusicReferenceRevision.Type> = []
      const albumId = $.model.fields.albumId?.trim()

      if (!$.model.pending && action === 'save' && kind === 'track' && albumId) {
        const album = $.queries.album

        if (
          !Predicate.isTagged(album, 'Success') ||
          album.waiting ||
          album.value.fields.id !== albumId ||
          !Schema.is(MusicRevision)(Number(album.value.fields.revision))
        )
          return $.evolve({
            error: 'Wait for the selected album revision to load before saving this track.',
          })
        references.push({
          entityType: 'album',
          entityId: albumId,
          expectedRevision: Number(album.value.fields.revision),
        })
      }

      const pending = $.model.pending ?? {
        action,
        kind,
        id: entity?.id ?? '',
        fields: $.model.fields,
        linkId,
        expectedRevision: action === 'save' || action === 'delete' ? expectedRevision : null,
        requestId: null,
        references,
      }

      return $.evolve({ busy: true, error: null, notice: null, pending }).run(
        WriteCatalog.make(pending),
      )
    },
    SucceededWrite: ($, { action }) =>
      $.evolve({
        busy: false,
        pending: null,
        resetFields: action === 'save' || action === 'create-label',
        refreshing: action !== 'delete',
        confirming: false,
        deleted: action === 'delete',
        revision: $.model.revision + 1,
        notice: Match.value(action).pipe(
          Match.when('save', () => 'Entity saved.'),
          Match.when('delete', () => 'Entity deleted.'),
          Match.orElse(() => 'Catalogue changes saved.'),
        ),
        fields: { ...$.model.fields, linkUrl: '' },
      }),
    FailedWrite: ($, { message, pending, uncertain }) =>
      $.evolve({ busy: false, error: message, pending: uncertain ? pending : null }),
  },
  view: (h, model) => {
    const entity = entityRoute(h.props.section)

    const document = Predicate.isTagged(h.queries.document, 'Success')
      ? h.queries.document.value
      : h.props.initialDocument

    const field = (name: string) => {
      const labelFor = () => {
        if (!entity && name === 'name') return 'Label name'

        if (!entity && name === 'slug') return 'Label slug'

        if (name === 'platform') return 'Platform'

        if (name === 'linkUrl') return 'Link URL'

        return name
      }

      const label = labelFor()
      const disabled = model.busy || model.refreshing || model.pending !== null

      if (['bio', 'content', 'description'].includes(name))
        return h.label.children(
          label,
          h.textarea
            .attr('rows', '5')
            .disabled(disabled)
            .value(model.fields[name] ?? '')
            .on('input', ({ value }) => CatalogMessage.UpdatedField({ name, value })),
        )

      return Field(
        h,
        name,
        label,
        model.fields[name] ?? '',
        (value) => CatalogMessage.UpdatedField({ name, value }),
        'text',
        disabled,
      )
    }

    const action = (value: typeof CatalogAction.Type, label: string, linkId = '') =>
      h.button
        .disabled(
          model.busy ||
            model.refreshing ||
            (model.pending !== null && model.pending.action !== value),
        )
        .on('click', CatalogMessage.ClickedAction({ action: value, linkId }))
        .children(label)

    return h.section
      .class('admin-page')
      .onMount(StartCatalogQueries({}))
      .children(
        Notice(h, model.error, true),
        Notice(h, model.notice),
        entity?.kind === 'track' && model.fields.albumId?.trim() && h.queries.album.waiting
          ? h.p.attr('role', 'status').children('Loading the selected album revision…')
          : undefined,
        Predicate.isTagged(h.queries.album, 'Failure')
          ? h.p
              .attr('role', 'alert')
              .children(
                'Could not observe the selected album. Check its ID and refresh before saving.',
              )
          : undefined,
        entity
          ? h.a.attr('href', '/dashboard/music').children('Back to catalog')
          : h.nav
              .attr('aria-label', 'Music catalogue')
              .children(
                ['artists', 'albums', 'tracks', 'playlists', 'labels'].map((tab) =>
                  h.a
                    .attr('href', `/dashboard/music?tab=${tab}`)
                    .children(`${tab[0]?.toUpperCase()}${tab.slice(1)}`),
                ),
              ),
        h.button
          .disabled(model.busy)
          .on('click', CatalogMessage.ClickedRefresh())
          .children('Refresh'),
        !entity
          ? [
              DataTable(
                h,
                `${(document.fields.tab ?? 'artists')[0]?.toUpperCase()}${(document.fields.tab ?? 'artists').slice(1)}`,
                ['Name', 'Slug', 'Status', 'Actions'],
              ).children(
                h.tbody.children(
                  document.rows.map((row) =>
                    h.tr
                      .key(row.id)
                      .class('admin-row')
                      .children(
                        h.td(row.title),
                        h.td(row.detail),
                        h.td(row.status ?? ''),
                        h.td.children(h.a.attr('href', row.href ?? undefined).children('Edit')),
                      ),
                  ),
                ),
              ),
              document.fields.tab === 'labels'
                ? h.details.children(
                    h.summary('New label'),
                    h.div
                      .class('dashboard-form')
                      .children(
                        field('name'),
                        field('slug'),
                        action('create-label', 'Create label'),
                      ),
                  )
                : undefined,
            ]
          : !model.deleted
            ? [
                h.div
                  .class('dashboard-form')
                  .children(fieldsFor(entity.kind).map(field), action('save', 'Save entity')),
                h.details.children(
                  h.summary.on('click', CatalogMessage.ClickedDelete()).children('Delete entity'),
                  model.confirming
                    ? h.div.children(
                        h.p('Permanently delete this entity?'),
                        action('delete', 'Confirm delete entity'),
                        h.button
                          .on('click', CatalogMessage.ClickedCancelDelete())
                          .children('Cancel'),
                      )
                    : undefined,
                ),
                h.h2('Source links'),
                Predicate.isTagged(h.queries.links, 'Success')
                  ? DataTable(h, 'Source links', ['Platform', 'URL', 'Status', 'Actions']).children(
                      h.tbody.children(
                        h.queries.links.value.rows.map((row) =>
                          h.tr
                            .key(row.id)
                            .class('admin-row')
                            .children(
                              h.td(row.title),
                              h.td.children(
                                h.a.attr('href', row.href ?? undefined).children(row.detail),
                              ),
                              h.td(row.status ?? ''),
                              h.td.children(action('remove-link', 'Remove link', row.id)),
                            ),
                        ),
                      ),
                    )
                  : h.p('Source links are unavailable.'),
                field('platform'),
                field('linkUrl'),
                action('add-link', 'Add link'),
              ]
            : undefined,
      )
  },
})

export const DashboardCatalog = DashboardCatalogNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(ReadDashboard.layer, WriteCatalog.layer).pipe(
      Layer.provide(DashboardServiceLive),
    ),
  ),
)
