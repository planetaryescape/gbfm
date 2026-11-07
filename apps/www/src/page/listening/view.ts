import type { SavedMix } from '@gbfm/api/listening'
import { type HtmlBuilder, inertHtml as h } from 'foldkit/html'

import { Message } from '../../message'
import type { ListeningPage } from './document'

const fieldClass =
  'w-full min-w-0 border border-border bg-card px-3 py-2.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-highlight'

const buttonClass =
  'inline-flex min-h-11 items-center justify-center border border-border px-4 py-2 text-sm font-semibold transition-colors hover:border-highlight hover:text-highlight focus-visible:outline-2 focus-visible:outline-highlight'

const summaryClass =
  'cursor-pointer py-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-highlight'

const statuses = [
  ['to-listen', 'To listen'],
  ['listening', 'Listening'],
  ['listened', 'Listened'],
] as const

const hidden = (name: string, value: string) =>
  h.input([h.Type('hidden'), h.Name(name), h.Value(value)])

const button = (label: string) => h.button([h.Type('submit'), h.Class(buttonClass)], [label])

const textField = (name: string, label: string, value = '', required = false) =>
  h.label(
    [h.Class('grid gap-2 text-xs text-muted-foreground')],
    [
      label,
      h.input([
        h.Name(name),
        h.Attribute('value', value),
        h.Required(required),
        h.Maxlength(300),
        h.Class(fieldClass),
      ]),
    ],
  )

const checkbox = (name: string, label: string, checked = false) =>
  h.label(
    [h.Class('flex min-h-11 items-center gap-3 text-xs')],
    [
      h.input([
        h.Type('checkbox'),
        h.Name(name),
        h.Value('true'),
        ...(checked ? [h.Attribute('checked', '')] : []),
        h.Class('size-4 shrink-0 accent-current'),
      ]),
      label,
    ],
  )

const deskHref = (collection = '', status = '', mix = '') => {
  const query = new URLSearchParams()

  if (collection) query.set('collection', collection)

  if (status) query.set('status', status)

  if (mix) query.set('mix', mix)

  return `/listening${query.size ? `?${query}` : ''}`
}

const action = (
  operation: string,
  returnTo: string,
  children: NonNullable<Parameters<typeof h.form>[1]>,
) =>
  h.form(
    [h.Method('post'), h.Action(`/actions/listening/${operation}`), h.Class('grid gap-3')],
    [hidden('returnTo', returnTo), ...children],
  )

const source = (mix: SavedMix) =>
  h.div(
    [h.Class('flex flex-wrap items-center justify-between gap-3 text-xs')],
    [
      h.span([h.Class('text-muted-foreground capitalize')], [mix.platform]),
      h.a(
        [
          h.Href(mix.url),
          h.Target('_blank'),
          h.Rel('noopener noreferrer'),
          h.Class(
            'inline-flex min-h-11 items-center underline underline-offset-4 hover:text-highlight',
          ),
        ],
        ['Open on original platform ↗'],
      ),
    ],
  )

const embed = (mix: SavedMix) =>
  mix.embedUrl
    ? h.details(
        [h.Class('border-t border-border')],
        [
          h.summary([h.Class(summaryClass)], ['Listen here']),
          h.iframe(
            [
              h.Src(mix.embedUrl),
              h.Title(`Listen to ${mix.title}`),
              h.Loading('lazy'),
              h.Attribute('allow', 'encrypted-media; fullscreen; picture-in-picture'),
              h.Class('mb-4 h-64 w-full border-0 bg-background'),
            ],
            [],
          ),
        ],
      )
    : h.empty

const importPanel = (page: ListeningPage, returnTo: string) =>
  h.details(
    [...(page.preview ? [h.Attribute('open', '')] : []), h.Class('group border-b border-border')],
    [
      h.summary([h.Class(`${summaryClass} text-foreground font-semibold`)], ['+ Add mixes']),
      h.div(
        [h.Class('grid gap-5 pb-6')],
        [
          h.form(
            [h.Method('get'), h.Action('/listening'), h.Class('grid gap-3')],
            [
              h.label(
                [h.Class('grid gap-2 text-xs text-muted-foreground')],
                [
                  'Mix or public playlist URL',
                  h.input([
                    h.Type('url'),
                    h.Name('import'),
                    h.Required(true),
                    h.Maxlength(2048),
                    h.Placeholder('Paste a link from YouTube, Spotify, SoundCloud or Mixcloud'),
                    h.Class(fieldClass),
                  ]),
                ],
              ),
              button('Preview import'),
            ],
          ),
          h.p(
            [h.Class('text-xs leading-5 text-muted-foreground')],
            ['One-time snapshots, not synced playlists. Existing saves keep their notes.'],
          ),
          h.details(
            [],
            [
              h.summary([h.Class(summaryClass)], ['Paste several individual links']),
              action('bulk-links', returnTo, [
                h.label(
                  [h.Class('grid gap-2 text-xs')],
                  [
                    'One mix URL per line (up to 200)',
                    h.textarea([h.Name('links'), h.Rows(5), h.Required(true), h.Class(fieldClass)]),
                  ],
                ),
                button('Save links privately'),
              ]),
            ],
          ),
          page.preview
            ? h.div(
                [h.Class('grid gap-4 border-t border-border pt-5')],
                [
                  h.h2(
                    [h.Class('text-sm font-semibold')],
                    [`Import preview · ${page.preview.items.length} mixes`],
                  ),
                  ...page.preview.warnings.map((warning) =>
                    h.p([h.Class('text-xs leading-6 text-muted-foreground')], [warning]),
                  ),
                  action('save-import', returnTo, [
                    h.div(
                      [h.Class('grid max-h-72 gap-3 overflow-y-auto')],
                      page.preview.items.map((item) =>
                        h.label(
                          [h.Class('flex min-h-11 items-center gap-3 text-xs')],
                          [
                            h.input([
                              h.Type('checkbox'),
                              h.Name('item'),
                              h.Value(JSON.stringify(item)),
                              h.Checked(true),
                              h.Class('size-4 shrink-0 accent-current'),
                            ]),
                            h.span([h.Class('min-w-0 break-all')], [item.title]),
                          ],
                        ),
                      ),
                    ),
                    page.preview.items.length ? button('Save selected mixes privately') : h.empty,
                  ]),
                ],
              )
            : h.empty,
        ],
      ),
    ],
  )

const mixEditor = (
  mix: SavedMix,
  page: ListeningPage,
  returnTo: string,
  h: HtmlBuilder<Message>,
  focused: boolean,
  queueHref: string,
) => {
  const published = page.document.mixes.some((saved) => saved.id === mix.id && saved.published)

  return h.aside(
    [
      h.Id('mix-notes'),
      h.AriaLabel('Mix notes'),
      h.Class(
        `${focused ? '' : 'hidden lg:block'} min-w-0 border-b border-border bg-card p-5 lg:border-b-0 lg:border-l lg:p-7`,
      ),
    ],
    [
      h.a([h.Href(queueHref), h.Class('mb-6 block text-xs lg:hidden')], ['← Back to queue']),
      h.div(
        [h.Class('mb-6 flex items-center justify-between gap-3')],
        [
          h.h2([h.Class('text-xs font-semibold uppercase tracking-widest')], ['Your notes']),
          h.span(
            [h.Class(`text-xs ${published ? 'text-highlight' : 'text-muted-foreground'}`)],
            [published ? 'Published' : 'Private draft'],
          ),
        ],
      ),
      action('edit-mix', returnTo, [
        hidden('id', mix.id),
        hidden('expectedVersion', mix.version ?? ''),
        h.label(
          [],
          [
            h.span([h.Class('sr-only')], ['Mix title']),
            h.textarea([
              h.Name('title'),
              h.Value(mix.title),
              h.OnInput((title) =>
                Message.ListeningDraftChanged({ id: mix.id, change: { title } }),
              ),
              h.Rows(2),
              h.Required(true),
              h.Maxlength(300),
              h.Class(
                'w-full min-w-0 resize-none border-b border-transparent bg-transparent pb-2 text-lg font-semibold leading-7 text-foreground hover:border-border focus-visible:outline-2 focus-visible:outline-highlight',
              ),
            ]),
          ],
        ),
        source(mix),
        h.label(
          [h.Class('mt-3 grid gap-3 text-xs text-muted-foreground')],
          [
            'Listening notes',
            h.textarea([
              h.Name('notes'),
              h.Value(mix.notes),
              h.OnInput((notes) =>
                Message.ListeningDraftChanged({ id: mix.id, change: { notes } }),
              ),
              h.Rows(6),
              h.Maxlength(20000),
              h.Placeholder(
                'What stayed with you? A transition, a feeling, a moment to return to…',
              ),
              h.Class(`${fieldClass} resize-y leading-7`),
            ]),
          ],
        ),
        h.label(
          [h.Class('grid grid-cols-[1fr_auto] items-center gap-3 text-xs text-muted-foreground')],
          [
            'Listening status',
            h.select(
              [
                h.Name('status'),
                h.Class(fieldClass),
                h.OnChange((value) =>
                  Message.ListeningDraftChanged({
                    id: mix.id,
                    change: {
                      status: statuses.find(([status]) => status === value)?.[0] ?? mix.status,
                    },
                  }),
                ),
              ],
              statuses.map(([value, label]) =>
                h.option([h.Value(value), h.Selected(mix.status === value)], [label]),
              ),
            ),
          ],
        ),
        h.label(
          [h.Class('flex min-h-11 items-center gap-3 text-xs')],
          [
            h.input([
              h.Type('checkbox'),
              h.Name('published'),
              h.Value('true'),
              h.Checked(mix.published),
              h.OnChange(() =>
                Message.ListeningDraftChanged({
                  id: mix.id,
                  change: { published: !mix.published },
                }),
              ),
              h.Class('size-4 shrink-0 accent-current'),
            ]),
            'Publish this mix and its notes',
          ],
        ),
        h.p(
          [h.Class('text-xs leading-5 text-muted-foreground')],
          [
            published
              ? 'Saved edits go live in your public collections.'
              : 'Private until you publish. Public collections only show published mixes.',
          ],
        ),
        h.button(
          [
            h.Type('submit'),
            h.Class(
              `${buttonClass} mt-2 border-highlight bg-highlight text-highlight-foreground hover:bg-background`,
            ),
          ],
          ['Save notes & status'],
        ),
        h.p([h.Class('text-xs leading-5 text-muted-foreground')], ['Save before switching mixes.']),
      ]),
      h.div([h.Class('mt-6')], [embed(mix)]),
      h.details(
        [h.Class('border-t border-border')],
        [
          h.summary([h.Class(summaryClass)], ['Collections & more']),
          h.div(
            [h.Class('grid gap-3 pb-4')],
            [
              ...page.document.collections.map((collection) => {
                const included = page.document.memberships.some(
                  (link) => link.collectionId === collection.id && link.mixId === mix.id,
                )

                return action('membership', returnTo, [
                  hidden('id', collection.id),
                  hidden('expectedVersion', collection.version ?? ''),
                  hidden('mixId', mix.id),
                  hidden('included', String(!included)),
                  button(`${included ? '− Remove from' : '+ Add to'} ${collection.title}`),
                ])
              }),
              page.document.collections.length === 0
                ? h.p(
                    [h.Class('text-xs text-muted-foreground')],
                    ['Create a collection to group your mixes.'],
                  )
                : h.empty,
              action('delete-mix', returnTo, [
                hidden('id', mix.id),
                hidden('expectedVersion', mix.version ?? ''),
                button('Remove saved mix'),
              ]),
            ],
          ),
        ],
      ),
    ],
  )
}

const collectionSettings = (
  collection: ListeningPage['document']['collections'][number] | undefined,
  returnTo: string,
) =>
  h.div(
    [h.Class('grid gap-2 border-t border-border pt-3')],
    [
      h.details(
        [],
        [
          h.summary([h.Class(summaryClass)], ['+ New collection']),
          action('create-collection', returnTo, [
            textField('title', 'Collection name', '', true),
            textField('description', 'Description'),
            checkbox('published', 'Make collection public'),
            button('Create collection'),
          ]),
        ],
      ),
      collection
        ? h.details(
            [h.Key(collection.id)],
            [
              h.summary([h.Class(summaryClass)], ['Collection settings']),
              h.div(
                [h.Class('grid gap-4')],
                [
                  action('edit-collection', returnTo, [
                    hidden('id', collection.id),
                    hidden('expectedVersion', collection.version ?? ''),
                    textField('title', 'Collection name', collection.title, true),
                    textField('description', 'Description', collection.description),
                    checkbox('published', 'Make collection public', collection.published),
                    button('Save collection'),
                  ]),
                  collection.published
                    ? h.a(
                        [
                          h.Href(`/collections/${collection.id}`),
                          h.Class('py-3 text-xs text-highlight underline underline-offset-4'),
                        ],
                        ['View public collection ↗'],
                      )
                    : h.empty,
                  action('delete-collection', '/listening', [
                    hidden('id', collection.id),
                    hidden('expectedVersion', collection.version ?? ''),
                    button('Delete collection'),
                  ]),
                ],
              ),
            ],
          )
        : h.empty,
    ],
  )

const publicEntry = (mix: SavedMix, index: number) =>
  h.article(
    [
      h.Key(mix.id),
      h.Class(
        'grid grid-cols-[2rem_minmax(0,1fr)] gap-3 border-t border-border py-7 sm:gap-6 sm:py-9',
      ),
    ],
    [
      h.span([h.Class('pt-1 text-xs text-muted-foreground')], [String(index + 1).padStart(2, '0')]),
      h.div(
        [h.Class('min-w-0')],
        [
          h.h2([h.Class('break-words text-lg font-semibold sm:text-xl')], [mix.title]),
          source(mix),
          mix.notes
            ? h.p(
                [h.Class('mb-6 mt-4 whitespace-pre-wrap break-words text-sm leading-8')],
                [mix.notes],
              )
            : h.empty,
          embed(mix),
        ],
      ),
    ],
  )

/** A link-addressable listening desk with one editor; public collections are read-only journals. */
export const view = (
  page: ListeningPage,
  url: URL,
  signedIn: boolean,
  builder: HtmlBuilder<Message>,
  draft: SavedMix | null,
) => {
  const collectionId = page.workspace ? (url.searchParams.get('collection') ?? '') : ''
  const status = page.workspace ? (url.searchParams.get('status') ?? '') : ''

  const collection = page.workspace
    ? page.document.collections.find((item) => item.id === collectionId)
    : page.document.collections[0]

  const inCollection = page.document.mixes.filter(
    (mix) =>
      !collectionId ||
      page.document.memberships.some(
        (link) => link.collectionId === collectionId && link.mixId === mix.id,
      ),
  )

  const mixes = inCollection.filter((mix) => !status || mix.status === status)
  const selected = mixes.find((mix) => mix.id === url.searchParams.get('mix')) ?? mixes[0]
  const returnTo = deskHref(collectionId, status, selected?.id)
  const directory = !page.workspace && url.pathname === '/collections'

  const notice = h.div(
    [],
    [
      page.error
        ? h.p(
            [h.Role('alert'), h.Class('mb-5 border-l-2 border-highlight pl-4 text-sm')],
            [page.error],
          )
        : h.empty,
      url.searchParams.has('saved')
        ? h.p(
            [h.Role('status'), h.Class('mb-4 text-xs text-highlight')],
            ['Saved. Your changes are up to date.'],
          )
        : h.empty,
    ],
  )

  if (!page.workspace)
    return h.section(
      [h.Class('mx-auto max-w-4xl px-5 pb-36 pt-10 sm:px-8 sm:pt-16')],
      [
        h.header(
          [h.Class('mb-10 sm:mb-14')],
          [
            h.div(
              [
                h.Class(
                  'mb-8 flex items-center justify-between gap-4 text-xs text-muted-foreground',
                ),
              ],
              [
                h.a(
                  [h.Href('/collections'), h.Class('py-3 hover:text-highlight')],
                  ['← Collections'],
                ),
                h.a(
                  [h.Href('/listening'), h.Class('py-3 hover:text-highlight')],
                  ['Your listening pile ↗'],
                ),
              ],
            ),
            h.p(
              [h.Class('mb-4 text-xs uppercase tracking-widest text-highlight')],
              [directory ? 'Selected by listeners' : 'Public collection'],
            ),
            h.h1(
              [h.Class('break-words text-4xl font-bold tracking-tight sm:text-5xl')],
              [directory ? 'Mix collections' : (collection?.title ?? 'Collection')],
            ),
            h.p(
              [h.Class('mt-5 max-w-2xl text-sm leading-7 text-muted-foreground')],
              [
                directory
                  ? 'Good music, with a few words from the person who found it.'
                  : (collection?.description ?? ''),
              ],
            ),
            !directory && collection
              ? h.p([h.Class('mt-5 text-xs')], [`Collected by ${collection.ownerName}`])
              : h.empty,
          ],
        ),
        notice,
        ...(directory
          ? page.document.collections.map((item, index) =>
              h.a(
                [
                  h.Href(`/collections/${item.id}`),
                  h.Class(
                    'group grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-4 border-t border-border py-7 transition-colors hover:text-highlight',
                  ),
                ],
                [
                  h.span(
                    [h.Class('pt-1 text-xs text-muted-foreground')],
                    [String(index + 1).padStart(2, '0')],
                  ),
                  h.div(
                    [h.Class('min-w-0')],
                    [
                      h.h2([h.Class('break-words text-xl font-semibold')], [item.title]),
                      h.p(
                        [h.Class('mt-2 text-xs text-muted-foreground')],
                        [`By ${item.ownerName}`],
                      ),
                      h.p(
                        [h.Class('mt-3 text-sm leading-7 text-muted-foreground')],
                        [item.description],
                      ),
                    ],
                  ),
                  h.span([h.AriaHidden(true)], ['↗']),
                ],
              ),
            )
          : page.document.mixes.map(publicEntry)),
        !page.error && (directory ? !page.document.collections.length : !page.document.mixes.length)
          ? h.p(
              [h.Class('border-t border-border py-8 text-sm text-muted-foreground')],
              [
                directory
                  ? 'No public collections yet. Start one from your listening pile.'
                  : 'No published mixes in this collection yet.',
              ],
            )
          : h.empty,
      ],
    )

  return h.section(
    [h.Class('mx-auto max-w-7xl bg-card px-4 pb-36 pt-8 sm:px-8 sm:pt-10')],
    [
      h.header(
        [h.Class('mb-8 flex flex-wrap items-end justify-between gap-4')],
        [
          h.div(
            [],
            [
              h.p(
                [h.Class('mb-3 text-xs uppercase tracking-widest text-muted-foreground')],
                ['Listening desk'],
              ),
              h.h1(
                [h.Class('text-2xl font-bold tracking-tight sm:text-3xl')],
                ['Your listening pile'],
              ),
            ],
          ),
          h.a(
            [
              h.Href('/collections'),
              h.Class('min-h-11 py-3 text-xs text-muted-foreground hover:text-highlight'),
            ],
            ['Explore public collections ↗'],
          ),
        ],
      ),
      notice,
      !signedIn
        ? h.div(
            [h.Class('border-t border-border py-8')],
            [
              h.p(
                [h.Class('mb-6 text-sm text-muted-foreground')],
                ['Sign in to save mixes, write notes and build your own collections.'],
              ),
              h.a(
                [h.Href('/auth/sign-in?returnTo=%2Flistening'), h.Class(buttonClass)],
                ['Sign in'],
              ),
              h.a(
                [h.Href('/auth/sign-up?returnTo=%2Flistening'), h.Class(`${buttonClass} ml-3`)],
                ['Create account'],
              ),
            ],
          )
        : h.div(
            [h.Class('grid border-t border-border md:grid-cols-[180px_minmax(0,1fr)]')],
            [
              h.aside(
                [
                  h.Class(
                    'min-w-0 border-b border-border pb-5 pt-5 md:border-b-0 md:border-r md:pr-5',
                  ),
                ],
                [
                  h.nav(
                    [
                      h.AriaLabel('Your collections'),
                      h.Class('flex flex-wrap gap-1 text-xs md:grid'),
                    ],
                    [
                      h.h2(
                        [h.Class('mb-3 hidden text-xs font-semibold md:block')],
                        ['Your collections'],
                      ),
                      h.a(
                        [
                          h.Href('/listening'),
                          h.Attribute('aria-current', !collectionId ? 'page' : 'false'),
                          h.Class(
                            `flex min-h-11 items-center justify-between gap-2 px-2 no-underline ${!collectionId ? 'bg-muted text-highlight' : 'text-muted-foreground hover:text-foreground'}`,
                          ),
                        ],
                        ['All mixes', h.span([], [String(page.document.mixes.length)])],
                      ),
                      ...page.document.collections.map((item) =>
                        h.a(
                          [
                            h.Href(deskHref(item.id)),
                            h.AriaLabel(`${item.title} · ${item.published ? 'public' : 'private'}`),
                            h.Attribute(
                              'aria-current',
                              collectionId === item.id ? 'page' : 'false',
                            ),
                            h.Class(
                              `flex min-h-11 items-center gap-2 px-2 no-underline ${collectionId === item.id ? 'bg-muted text-highlight' : 'text-muted-foreground hover:text-foreground'}`,
                            ),
                          ],
                          [h.span([h.Class('min-w-0 break-words')], [item.title])],
                        ),
                      ),
                    ],
                  ),
                  collectionSettings(collection, returnTo),
                ],
              ),
              h.div(
                [h.Class('min-w-0 md:pl-6')],
                [
                  importPanel(page, returnTo),
                  h.nav(
                    [
                      h.AriaLabel('Listening status'),
                      h.Class('flex flex-wrap gap-x-5 border-b border-border text-xs'),
                    ],
                    [['', 'All'], ...statuses].map(([value, label]) =>
                      h.a(
                        [
                          h.Href(deskHref(collectionId, value)),
                          h.Attribute('aria-current', status === value ? 'page' : 'false'),
                          h.Class(
                            `inline-flex min-h-12 items-center gap-2 border-b-2 no-underline ${status === value ? 'border-highlight text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`,
                          ),
                        ],
                        [
                          label,
                          h.span(
                            [h.Class('text-muted-foreground')],
                            [
                              String(
                                value
                                  ? inCollection.filter((mix) => mix.status === value).length
                                  : inCollection.length,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                  mixes.length
                    ? h.div(
                        [h.Class('grid min-w-0 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]')],
                        [
                          h.div(
                            [h.Class('min-w-0 order-last lg:order-first')],
                            [
                              h.h2([h.Class('sr-only')], ['Saved mixes']),
                              h.ol(
                                [],
                                mixes.map((mix, index) =>
                                  h.li(
                                    [h.Key(mix.id)],
                                    [
                                      h.a(
                                        [
                                          h.Href(
                                            `${deskHref(collectionId, status, mix.id)}#mix-notes`,
                                          ),
                                          h.Attribute(
                                            'aria-current',
                                            selected?.id === mix.id ? 'true' : 'false',
                                          ),
                                          h.Class(
                                            `group grid min-h-24 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-3 border-b border-l-2 border-b-border px-4 py-5 no-underline transition-colors ${selected?.id === mix.id ? 'border-l-highlight bg-muted' : 'border-l-transparent hover:bg-muted/50'}`,
                                          ),
                                        ],
                                        [
                                          h.span(
                                            [h.Class('pt-0.5 text-xs text-muted-foreground')],
                                            [String(index + 1).padStart(2, '0')],
                                          ),
                                          h.div(
                                            [h.Class('min-w-0')],
                                            [
                                              h.p(
                                                [
                                                  h.Class(
                                                    'break-words text-sm font-semibold leading-6 group-hover:text-highlight',
                                                  ),
                                                ],
                                                [mix.title],
                                              ),
                                              h.p(
                                                [
                                                  h.Class(
                                                    'mt-2 text-xs capitalize text-muted-foreground',
                                                  ),
                                                ],
                                                [mix.platform],
                                              ),
                                            ],
                                          ),
                                          h.span(
                                            [
                                              h.Class('pt-1 text-xs text-muted-foreground'),
                                              h.AriaHidden(true),
                                            ],
                                            ['→'],
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                              h.p(
                                [h.Class('px-4 py-5 text-xs text-muted-foreground')],
                                [`${mixes.length} ${mixes.length === 1 ? 'mix' : 'mixes'}`],
                              ),
                            ],
                          ),
                          selected
                            ? mixEditor(
                                draft?.id === selected.id ? draft : selected,
                                page,
                                returnTo,
                                builder,
                                url.searchParams.has('mix'),
                                deskHref(collectionId, status),
                              )
                            : h.empty,
                        ],
                      )
                    : h.div(
                        [h.Class('py-16')],
                        [
                          h.h2(
                            [h.Class('text-lg font-semibold')],
                            [
                              status
                                ? 'Nothing in this queue. Yet.'
                                : collection
                                  ? 'A collection starts with one mix.'
                                  : 'Make room for a good listen.',
                            ],
                          ),
                          h.p(
                            [h.Class('mt-3 max-w-sm text-sm leading-7 text-muted-foreground')],
                            [
                              status
                                ? 'Try another listening status, or add a mix.'
                                : collection
                                  ? 'Select a saved mix from All mixes, then add it through Collections & more.'
                                  : 'Open Add mixes above. Paste a favourite, or bring over a public playlist to get started.',
                            ],
                          ),
                        ],
                      ),
                ],
              ),
            ],
          ),
    ],
  )
}
