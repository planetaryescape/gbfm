import { CreateShowInput, GetAllShowsResponse } from '@gbfm/api/shows'
import { Effect, Schema } from 'effect'
import { Command, type Update } from 'foldkit'
import type { HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'

import { DashboardService } from '../service'
import { badge, dataTable, emptyState, frame, pageHeader, pageRange, pager } from '../ui'

const fields = [
  'title',
  'slug',
  'description',
  'content',
  'thumbnailUrl',
  'bannerImageUrl',
  'tags',
] as const

const Field = Schema.Literals(fields)

const Form = Schema.Struct({
  title: Schema.String,
  slug: Schema.String,
  description: Schema.String,
  content: Schema.String,
  thumbnailUrl: Schema.String,
  bannerImageUrl: Schema.String,
  tags: Schema.String,
})

const emptyForm = {
  title: '',
  slug: '',
  description: '',
  content: '',
  thumbnailUrl: '',
  bannerImageUrl: '',
  tags: '',
}

const Editor = Schema.TaggedUnion({
  Listing: {},
  Creating: {},
  Editing: { slug: Schema.String },
})

const editingSlug = (model: Model) =>
  Editor.guards.Editing(model.editor) ? model.editor.slug : null

const busy = (model: Model) => model.operation !== 'idle'

export const Model = Schema.Struct({
  listing: Schema.optional(GetAllShowsResponse),
  form: Form,
  draft: Schema.Boolean,
  editor: Editor,
  deleting: Schema.NullOr(Schema.String),
  operation: Schema.Literals(['idle', 'loading', 'saving', 'deleting']),
  error: Schema.NullOr(Schema.String),
  notice: Schema.String,
})

export type Model = typeof Model.Type

export const initialModel: Model = {
  form: emptyForm,
  draft: true,
  editor: Editor.cases.Listing.make({}),
  deleting: null,
  operation: 'idle',
  error: null,
  notice: '',
}

export const Message = defineMessageUnion({
  FieldChanged: { field: Field, value: Schema.String },
  DraftChanged: {},
  New: {},
  Edit: { slug: Schema.String },
  Clear: {},
  Save: {},
  AskDelete: { slug: Schema.String },
  CancelDelete: {},
  ConfirmDelete: {},
  Load: { offset: Schema.Number },
  Loaded: { listing: GetAllShowsResponse },
  Saved: {},
  Failed: { message: Schema.String },
})

export type Message = typeof Message.Type

const Load = Command.define('Shows.Load', {
  args: { offset: Schema.Number },
  messages: [Message.Loaded, Message.Failed],
  execute: ({ offset }) =>
    DashboardService.pipe(
      Effect.flatMap((service) =>
        service.request({ path: `/api/shows/manage?limit=25&offset=${offset}` }),
      ),
      Effect.map((document) =>
        document.shows
          ? Message.Loaded({ listing: document.shows })
          : Message.Failed({ message: 'Invalid shows response.' }),
      ),
      Effect.catch((error) => Effect.succeed(Message.Failed({ message: error.message }))),
    ),
})

const Save = Command.define('Shows.Save', {
  args: { form: Form, draft: Schema.Boolean, editing: Schema.NullOr(Schema.String) },
  messages: [Message.Saved, Message.Failed],
  execute: ({ form, draft, editing }) =>
    Effect.gen(function* () {
      const payload = yield* Schema.decodeUnknownEffect(CreateShowInput)({
        ...form,
        title: form.title.trim(),
        slug: form.slug.trim(),
        draft,
        tags: form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      })

      const service = yield* DashboardService
      yield* service.request({
        path: editing ? `/api/shows/${encodeURIComponent(editing)}` : '/api/shows',
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })

      return Message.Saved()
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(
          Message.Failed({
            message:
              'Could not save the show. Check required fields, slug availability and your access.',
          }),
        ),
      ),
    ),
})

const Delete = Command.define('Shows.Delete', {
  args: { slug: Schema.String },
  messages: [Message.Saved, Message.Failed],
  execute: ({ slug }) =>
    DashboardService.pipe(
      Effect.flatMap((service) =>
        service.request({ path: `/api/shows/${encodeURIComponent(slug)}`, method: 'DELETE' }),
      ),
      Effect.as(Message.Saved()),
      Effect.catch((error) => Effect.succeed(Message.Failed({ message: error.message }))),
    ),
})

export const update = (
  model: Model,
  message: Message,
): Update.Return<Model, Message, DashboardService> =>
  Message.match<Update.Return<Model, Message, DashboardService>>(message, {
    FieldChanged: ({ field, value }) =>
      busy(model) ? { model } : { model: { ...model, form: { ...model.form, [field]: value } } },
    DraftChanged: () => (busy(model) ? { model } : { model: { ...model, draft: !model.draft } }),
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
    Edit: ({ slug }) => {
      const show = model.listing?.data.find((show) => show.slug === slug)

      if (!show || busy(model)) return { model }

      return {
        model: {
          ...model,
          editor: Editor.cases.Editing.make({ slug }),
          deleting: null,
          error: null,
          notice: '',
          draft: show.draft,
          form: {
            title: show.title,
            slug: show.slug,
            description: show.description ?? '',
            content: show.content,
            thumbnailUrl: show.thumbnailUrl ?? '',
            bannerImageUrl: show.bannerImageUrl ?? '',
            tags: show.tags?.join(', ') ?? '',
          },
        },
      }
    },
    Clear: () => (busy(model) ? { model } : { model: { ...initialModel, listing: model.listing } }),
    Save: () =>
      busy(model)
        ? { model }
        : {
            model: { ...model, operation: 'saving', error: null },
            commands: [Save({ form: model.form, draft: model.draft, editing: editingSlug(model) })],
          },
    AskDelete: ({ slug }) =>
      busy(model) || !model.listing?.data.some((show) => show.slug === slug)
        ? { model }
        : { model: { ...model, deleting: slug } },
    CancelDelete: () => (busy(model) ? { model } : { model: { ...model, deleting: null } }),
    ConfirmDelete: () =>
      busy(model) || !model.deleting
        ? { model }
        : {
            model: { ...model, operation: 'deleting', error: null },
            commands: [Delete({ slug: model.deleting })],
          },
    Load: ({ offset }) =>
      busy(model)
        ? { model }
        : { model: { ...model, operation: 'loading', error: null }, commands: [Load({ offset })] },
    Loaded: ({ listing }) => ({ model: { ...model, listing, operation: 'idle', error: null } }),
    Saved: () => ({
      model: {
        ...initialModel,
        listing: model.listing,
        operation: 'loading',
        notice: 'Show changes saved.',
      },
      commands: [Load({ offset: 0 })],
    }),
    Failed: ({ message }) => ({ model: { ...model, operation: 'idle', error: message } }),
  })

const labels = {
  title: 'Title',
  slug: 'Slug',
  description: 'Description',
  content: 'Content',
  thumbnailUrl: 'Thumbnail URL',
  bannerImageUrl: 'Banner URL',
  tags: 'Tags (comma separated)',
}

const showForm = (model: Model, h: HtmlBuilder<Message>) => {
  const editing = editingSlug(model)
    ? model.listing?.data.find((show) => show.slug === editingSlug(model))
    : undefined

  return h.form(
    [h.Class('dashboard-panel dashboard-form admin-form-grid'), h.OnSubmit(Message.Save())],
    [
      h.h2([h.Class('admin-form-title')], [editing ? `Edit ${editing.title}` : 'New show']),
      ...fields.map((field) =>
        h.label(
          field === 'content' || field === 'description' ? [h.Class('admin-form-wide')] : [],
          [
            labels[field],
            field === 'content' || field === 'description'
              ? h.textarea([
                  h.Value(model.form[field]),
                  h.Disabled(busy(model)),
                  h.Rows(field === 'content' ? 6 : 3),
                  h.OnInput((value) => Message.FieldChanged({ field, value })),
                ])
              : h.input([
                  h.Value(model.form[field]),
                  h.Disabled(busy(model)),
                  h.Required(field === 'title' || field === 'slug'),
                  h.OnInput((value) => Message.FieldChanged({ field, value })),
                ]),
          ],
        ),
      ),
      h.label(
        [h.Class('dashboard-toggle admin-form-wide')],
        [
          'Draft',
          h.input([
            h.Type('checkbox'),
            h.Checked(model.draft),
            h.Disabled(busy(model)),
            h.OnClick(Message.DraftChanged()),
          ]),
        ],
      ),
      h.div(
        [h.Class('admin-form-actions')],
        [
          h.button(
            [h.Type('submit'), h.Class('dashboard-button-primary'), h.Disabled(busy(model))],
            [busy(model) ? 'Saving' : editingSlug(model) ? 'Save changes' : 'Create show'],
          ),
          h.button(
            [h.Type('button'), h.Disabled(busy(model)), h.OnClick(Message.Clear())],
            ['Cancel'],
          ),
        ],
      ),
    ],
  )
}

export const view = defineView<Model, Message>((model, h) => {
  const page = model.listing?.pagination
  const formOpen = !Editor.guards.Listing(model.editor)

  return h.section(
    [h.Class('admin-page')],
    [
      pageHeader(h, 'Curated shows that group mixes on the public site.', [
        h.button(
          [
            h.Type('button'),
            h.Class('dashboard-button-primary'),
            h.Disabled(busy(model) || formOpen),
            h.OnClick(Message.New()),
          ],
          ['New show'],
        ),
      ]),
      model.error ? h.p([h.Role('alert'), h.Class('admin-notice')], [model.error]) : h.empty,
      model.notice ? h.p([h.Role('status'), h.Class('admin-notice')], [model.notice]) : h.empty,
      formOpen ? showForm(model, h) : h.empty,
      frame(h, [
        dataTable(h, {
          label: 'Shows',
          loading: !model.listing && busy(model),
          minWidth: '40rem',
          columns: [
            { label: 'Title' },
            { label: 'Slug', className: 'admin-col-mono', width: '30%' },
            { label: 'Status', width: '7.5rem' },
            { label: '', className: 'admin-col-actions', width: '12.5rem' },
          ],
          rows: (model.listing?.data ?? []).map((show) => ({
            key: show.id,
            cells: [
              h.strong([], [show.title]),
              show.slug,
              show.draft ? badge(h, 'Draft', 'neutral') : badge(h, 'Published', 'ok'),
              h.div(
                [h.Class('admin-actions')],
                [
                  !show.draft
                    ? h.a(
                        [
                          h.Class('admin-pager-control'),
                          h.Href(`/shows/${encodeURIComponent(show.slug)}`),
                        ],
                        ['View'],
                      )
                    : h.empty,
                  h.button(
                    [h.Disabled(busy(model)), h.OnClick(Message.Edit({ slug: show.slug }))],
                    ['Edit'],
                  ),
                  h.button(
                    [h.Disabled(busy(model)), h.OnClick(Message.AskDelete({ slug: show.slug }))],
                    ['Delete'],
                  ),
                ],
              ),
            ],
            detail:
              model.deleting === show.slug
                ? h.div(
                    [h.Class('admin-confirm'), h.Role('alert')],
                    [
                      h.p([], [`Permanently delete ${show.title}? This cannot be undone.`]),
                      h.button(
                        [h.Disabled(busy(model)), h.OnClick(Message.ConfirmDelete())],
                        ['Confirm delete'],
                      ),
                      h.button(
                        [h.Disabled(busy(model)), h.OnClick(Message.CancelDelete())],
                        ['Keep show'],
                      ),
                    ],
                  )
                : null,
          })),
          empty: emptyState(h, 'No shows yet. Create one to group mixes.'),
        }),
        page && page.total > 0
          ? pager(h, {
              label: 'Show pages',
              summary: pageRange(page.offset, model.listing?.data.length ?? 0, page.total),
              previous:
                page.offset > 0 && !busy(model)
                  ? { onClick: Message.Load({ offset: Math.max(0, page.offset - 25) }) }
                  : null,
              next:
                page.hasMore && !busy(model)
                  ? { onClick: Message.Load({ offset: page.offset + 25 }) }
                  : null,
            })
          : h.empty,
      ]),
    ],
  )
})
