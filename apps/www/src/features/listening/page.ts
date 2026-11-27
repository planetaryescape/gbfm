import { Html } from '@effect/ui/html'
import { Schema } from 'effect'

import { ListeningPage as ListeningDocument } from '../../domain/listening'
import { Principal } from '../../domain/principal'
import { CollectionSettings } from './collections'
import { MixEditor } from './editor'
import { buttonClass, deskHref, MixEmbed, MixSource } from './forms'
import { ImportPanel } from './import-panel'

export const ListeningPageProps = Schema.Struct({
  document: ListeningDocument,
  url: Schema.String,
  principal: Schema.NullOr(Principal),
})

export const ListeningPage = Html.component({
  name: 'ListeningPage',
  props: ListeningPageProps,
  model: Schema.Struct({}),
  message: Schema.Never,
}).make({
  init: () => ({}),
  update: ($) => $.model,
  view: (h) => {
    const props = h.props
    const page = props.document
    const url = new URL(props.url, 'https://gbfm.local')
    const collectionId = page.workspace ? (url.searchParams.get('collection') ?? '') : ''
    const status = page.workspace ? (url.searchParams.get('status') ?? '') : ''

    const collection = page.workspace
      ? page.document.collections.find((item) => item.id === collectionId)
      : page.document.collections[0]

    const mixes = page.document.mixes.filter(
      (mix) =>
        (!status || mix.status === status) &&
        (!collectionId ||
          page.document.memberships.some(
            (item) => item.collectionId === collectionId && item.mixId === mix.id,
          )),
    )

    const selected = mixes.find((mix) => mix.id === url.searchParams.get('mix')) ?? mixes[0]
    const returnTo = deskHref(collectionId, status, selected?.id)

    const notices = h.div.children(
      page.error ? h.p.attr('role', 'alert').children(page.error) : null,
      url.searchParams.has('saved')
        ? h.p.attr('role', 'status').children('Saved. Your changes are up to date.')
        : null,
    )

    if (!page.workspace) {
      const directory = url.pathname === '/collections'

      return h.section.class('mx-auto max-w-4xl px-5 pb-36 pt-10').children(
        h.a.attr('href', '/collections').children('← Collections'),
        h.a.attr('href', '/listening').children('Your listening pile ↗'),
        h.h1.children(directory ? 'Mix collections' : (collection?.title ?? 'Collection')),
        h.p.children(
          directory
            ? 'Good music, with a few words from the person who found it.'
            : (collection?.description ?? ''),
        ),
        collection && !directory ? h.p.children(`Collected by ${collection.ownerName}`) : null,
        notices,
        directory
          ? page.document.collections.map((item) =>
              h.a
                .attr('href', `/collections/${item.id}`)
                .class('block border-t py-7')
                .children(
                  h.h2.children(item.title),
                  h.p.children(`By ${item.ownerName}`),
                  h.p.children(item.description),
                ),
            )
          : page.document.mixes.map((mix) =>
              h.article
                .class('border-t border-border py-7')
                .children(
                  h.h2.children(mix.title),
                  MixSource(h, mix),
                  h.p.class('whitespace-pre-wrap').children(mix.notes),
                  MixEmbed(h, mix),
                ),
            ),
        !page.error && !(directory ? page.document.collections.length : page.document.mixes.length)
          ? h.p.children(
              directory
                ? 'No public collections yet. Start one from your listening pile.'
                : 'No published mixes in this collection yet.',
            )
          : null,
      )
    }

    if (!props.principal)
      return h.section
        .class('page')
        .children(
          h.h1.children('Your listening pile'),
          notices,
          h.p.children('Sign in to save mixes, write notes and build your own collections.'),
          h.a
            .attr('href', '/auth/sign-in?returnTo=%2Flistening')
            .class(buttonClass)
            .children('Sign in'),
          h.a
            .attr('href', '/auth/sign-up?returnTo=%2Flistening')
            .class(buttonClass)
            .children('Create account'),
        )

    return h.section.class('mx-auto max-w-7xl px-4 pb-36 pt-8').children(
      h.header.children(
        h.h1.children('Your listening pile'),
        h.a.attr('href', '/collections').children('Explore public collections ↗'),
      ),
      notices,
      h.div.class('grid gap-6 md:grid-cols-[180px_minmax(0,1fr)]').children(
        h.aside.children(
          h.nav
            .attr('aria-label', 'Your collections')
            .class('grid gap-3')
            .children(
              h.a.attr('href', '/listening').children(`All mixes (${page.document.mixes.length})`),
              page.document.collections.map((item) =>
                h.a
                  .attr('href', deskHref(item.id))
                  .attr('aria-current', item.id === collectionId ? 'page' : 'false')
                  .children(item.title),
              ),
            ),
          CollectionSettings(h, collection, returnTo),
        ),
        h.div.children(
          ImportPanel(h, page, returnTo),
          h.nav
            .attr('aria-label', 'Listening status')
            .class('flex gap-5 py-4')
            .children(
              [
                ['', 'All'],
                ['to-listen', 'To listen'],
                ['listening', 'Listening'],
                ['listened', 'Listened'],
              ].map(([value, label]) =>
                h.a
                  .attr('href', deskHref(collectionId, value))
                  .attr('aria-current', status === value ? 'page' : 'false')
                  .children(label),
              ),
            ),
          h.div.class('grid gap-4 lg:grid-cols-2').children(
            h.ol.children(
              mixes.map((mix) =>
                h.li.children(
                  h.a
                    .attr('href', `${deskHref(collectionId, status, mix.id)}#mix-notes`)
                    .attr('aria-current', mix.id === selected?.id ? 'true' : 'false')
                    .class('block border-b border-border px-4 py-5')
                    .children(h.h2.children(mix.title), h.p.children(mix.platform)),
                ),
              ),
            ),
            selected
              ? MixEditor(h, {
                  key: `${props.principal.id}:${selected.id}:${selected.version}`,
                  props: {
                    initialMix: selected,
                    page,
                    returnTo,
                    queueHref: deskHref(collectionId, status),
                  },
                })
              : h.p.children('Make room for a good listen. Open Add mixes above.'),
          ),
        ),
      ),
    )
  },
})
