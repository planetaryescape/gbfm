import { Component, Mount, UiSchema } from '@effect/ui'
import { Html } from '@effect/ui/html'
import { SavedMix } from '@gbfm/api/listening'
import { Effect, Schema } from 'effect'

import { ListeningPage } from '../../domain/listening'
import { HiddenField } from '../account/fields'
import { fieldClass, ListeningAction, MixEmbed, MixSource, Submit } from './forms'

const Status = SavedMix.fields.status

export const RevealMixNotes = Mount.make(
  'RevealMixNotes',
  { args: { id: Schema.String } },
  (node: HTMLElement, { id }) =>
    Effect.sync(() => {
      const location = new URL(node.ownerDocument.location.href)

      if (
        node.isConnected &&
        location.pathname === '/listening' &&
        location.hash === '#mix-notes' &&
        location.searchParams.get('mix') === id
      )
        node.scrollIntoView({ block: 'start' })

      return Component.noop
    }),
)

export const MixEditorMessage = UiSchema.TaggedEnum({
  UpdatedTitle: { value: Schema.String },
  UpdatedNotes: { value: Schema.String },
  UpdatedStatus: { value: Schema.String },
  ToggledPublished: {},
})

export const MixEditor = Html.component({
  name: 'MixEditor',
  props: Schema.Struct({
    initialMix: SavedMix,
    page: ListeningPage,
    returnTo: Schema.String,
    queueHref: Schema.String,
  }),
  model: SavedMix,
  message: MixEditorMessage,
}).make({
  init: ($) => $.props.initialMix,
  update: {
    UpdatedTitle: ($, { value }) => $.evolve({ title: value }),
    UpdatedNotes: ($, { value }) => $.evolve({ notes: value }),
    UpdatedStatus: ($, { value }) =>
      Schema.is(Status)(value) ? $.evolve({ status: value }) : $.model,
    ToggledPublished: ($) => $.evolve({ published: !$.model.published }),
  },
  view: (h, mix) =>
    h.aside
      .attr('id', 'mix-notes')
      .attr('aria-label', 'Mix notes')
      .onMount(RevealMixNotes({ id: mix.id }))
      .class('min-w-0 border-l border-border p-5')
      .children(
        h.a.attr('href', h.props.queueHref).children('← Back to queue'),
        h.h2.children('Your notes'),
        h.p.children(h.props.initialMix.published ? 'Published' : 'Private draft'),
        ListeningAction(h, 'edit-mix', h.props.returnTo, [
          HiddenField(h, 'id', mix.id),
          HiddenField(h, 'expectedVersion', mix.version ?? ''),
          h.label.children(
            'Mix title',
            h.textarea
              .attr('name', 'title')
              .attr('rows', '2')
              .attr('required', '')
              .attr('maxlength', '300')
              .class(fieldClass)
              .value(mix.title)
              .on('input', ({ value }) => MixEditorMessage.UpdatedTitle({ value })),
          ),
          MixSource(h, mix),
          h.label.children(
            'Listening notes',
            h.textarea
              .attr('name', 'notes')
              .attr('rows', '6')
              .attr('maxlength', '20000')
              .class(fieldClass)
              .value(mix.notes)
              .on('input', ({ value }) => MixEditorMessage.UpdatedNotes({ value })),
          ),
          h.label.children(
            'Listening status',
            h.select
              .attr('name', 'status')
              .class(fieldClass)
              .value(mix.status)
              .on('change', ({ value }) => MixEditorMessage.UpdatedStatus({ value }))
              .children(
                [
                  ['to-listen', 'To listen'],
                  ['listening', 'Listening'],
                  ['listened', 'Listened'],
                ].map(([value, label]) =>
                  h.option
                    .attr('value', value)
                    .selected(mix.status === value)
                    .children(label),
                ),
              ),
          ),
          h.label.children(
            h.input
              .attr('type', 'checkbox')
              .attr('name', 'published')
              .attr('value', 'true')
              .checked(mix.published)
              .on('change', MixEditorMessage.ToggledPublished()),
            'Publish this mix and its notes',
          ),
          h.p.children(
            h.props.initialMix.published
              ? 'Saved edits go live in your public collections.'
              : 'Private until you publish. Public collections only show published mixes.',
          ),
          Submit(h, 'Save notes & status'),
          h.p.children('Save before switching mixes.'),
        ]),
        MixEmbed(h, mix),
        h.details.children(
          h.summary.children('Collections & more'),
          h.props.page.document.collections.map((collection) => {
            const included = h.props.page.document.memberships.some(
              (item) => item.collectionId === collection.id && item.mixId === mix.id,
            )

            return ListeningAction(h, 'membership', h.props.returnTo, [
              HiddenField(h, 'id', collection.id),
              HiddenField(h, 'expectedVersion', collection.version ?? ''),
              HiddenField(h, 'mixId', mix.id),
              HiddenField(h, 'included', String(!included)),
              Submit(h, `${included ? '− Remove from' : '+ Add to'} ${collection.title}`),
            ])
          }),
          ListeningAction(h, 'delete-mix', h.props.returnTo, [
            HiddenField(h, 'id', mix.id),
            HiddenField(h, 'expectedVersion', mix.version ?? ''),
            Submit(h, 'Remove saved mix'),
          ]),
        ),
      ),
})
