import type { Html } from '@effect/ui/html'

import type { DashboardDocument } from './document'
import { plural } from './formatting'
import { type LibraryAction, LibraryMessage } from './library-messages'
import { DataTable, Field, Notice } from './presentation'

export const libraryFormFields = (section: string) =>
  section === 'shows'
    ? ['title', 'slug', 'description', 'content', 'thumbnailUrl', 'bannerImageUrl', 'tags']
    : ['title', 'slug', 'description', 'coverImageUrl', 'curatorId', 'publishedAt']

interface LibraryViewState {
  readonly editor: boolean
  readonly selected: string | null
  readonly fields: Readonly<Record<string, string>>
  readonly draft: boolean
  readonly confirming: boolean
  readonly busy: boolean
  readonly operation: string | null
  readonly offset: number
  readonly error: string | null
  readonly notice: string | null
}

export const LibraryView = (
  h: Html.H<typeof LibraryMessage.Type>,
  model: LibraryViewState,
  section: string,
  document: DashboardDocument,
  tracks: NonNullable<DashboardDocument['playlistTracks']>,
  failed: boolean,
) => {
  const shows = section === 'shows'

  const field = (name: string) => {
    const labels = new Map([
      ['title', shows ? 'Title' : 'Playlist title'],
      ['slug', shows ? 'Slug' : 'Playlist slug'],
      ['description', 'Description'],
      ['content', 'Content'],
      ['thumbnailUrl', 'Thumbnail URL'],
      ['bannerImageUrl', 'Banner image URL'],
      ['tags', 'Tags (comma separated)'],
      ['coverImageUrl', 'Cover image URL'],
      ['curatorId', 'Curator ID'],
      ['publishedAt', 'Published at'],
      ['trackUrl', 'Spotify track URL'],
      ['importUrl', 'Spotify playlist URL'],
    ])

    const label = labels.get(name) ?? name

    if (['description', 'content'].includes(name))
      return h.label.children(
        label,
        h.textarea
          .attr('rows', '5')
          .disabled(model.busy)
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
      .attr('type', 'button')
      .disabled(model.busy)
      .on('click', LibraryMessage.ClickedAction({ action: value, trackId }))
      .children(label)

  const keepLabel = shows ? 'Keep show' : 'Keep playlist'
  const confirmLabel = shows ? 'Confirm delete' : 'Confirm delete playlist'

  const confirmation = () =>
    h.div.children(
      h.p('Permanently delete this item?'),
      action('delete', confirmLabel),
      h.button
        .attr('type', 'button')
        .disabled(model.busy)
        .on('click', LibraryMessage.ClickedCancelDelete())
        .children(keepLabel),
    )

  const saveLabel = () => {
    if (model.operation === 'save') return 'Saving'

    if (!model.selected) return shows ? 'Create show' : 'Create playlist'

    return shows ? 'Save changes' : 'Save playlist'
  }

  const listing = () => {
    if (shows)
      return DataTable(h, 'Shows', ['Title', 'Slug', 'Status', 'Actions']).children(
        h.tbody.children(
          document.shows?.data.map((show) =>
            h.tr
              .key(show.id)
              .class('admin-row')
              .children(
                h.td.children(
                  h.a.attr('href', `/shows/${encodeURIComponent(show.slug)}`).children(show.title),
                ),
                h.td(show.slug),
                h.td(show.draft ? 'Draft' : 'Published'),
                h.td.class('dashboard-actions-cell').children(
                  h.button
                    .disabled(model.busy)
                    .on('click', LibraryMessage.ClickedEdit({ id: show.slug }))
                    .children('Edit'),
                  h.button
                    .disabled(model.busy)
                    .on('click', LibraryMessage.ClickedDeleteRow({ id: show.slug }))
                    .children('Delete'),
                  model.confirming && model.selected === show.slug ? confirmation() : undefined,
                ),
              ),
          ),
        ),
      )

    return DataTable(h, 'Playlists', ['Title', 'Slug', 'Status', 'Actions']).children(
      h.tbody.children(
        document.playlists?.map((playlist) =>
          h.tr
            .key(playlist.id)
            .class('admin-row')
            .children(
              h.td.children(
                h.a
                  .attr('href', `/music/playlists/${encodeURIComponent(playlist.slug)}`)
                  .children(playlist.title),
              ),
              h.td(playlist.slug),
              h.td(playlist.publishedAt ? 'Published' : 'Draft'),
              h.td.class('dashboard-actions-cell').children(
                h.button
                  .disabled(model.busy)
                  .on('click', LibraryMessage.ClickedEdit({ id: playlist.id }))
                  .children('Edit'),
              ),
            ),
        ),
      ),
    )
  }

  const trackList = () =>
    DataTable(h, 'Playlist tracks', ['Track', 'Artists', 'Actions']).children(
      h.tbody.children(
        tracks.map((entry, index) =>
          h.tr
            .key(entry.track.id)
            .class('admin-row')
            .children(
              h.td(entry.track.title),
              h.td(entry.track.artistNames?.join(', ') ?? ''),
              h.td.class('dashboard-actions-cell').children(
                h.button
                  .attr('aria-label', `Move ${entry.track.title} up`)
                  .disabled(model.busy || index === 0)
                  .on('click', LibraryMessage.ClickedMove({ id: entry.track.id, direction: 'up' }))
                  .children('Move up'),
                h.button
                  .attr('aria-label', `Move ${entry.track.title} down`)
                  .disabled(model.busy || index === tracks.length - 1)
                  .on(
                    'click',
                    LibraryMessage.ClickedMove({ id: entry.track.id, direction: 'down' }),
                  )
                  .children('Move down'),
                action('remove', `Remove ${entry.track.title}`, entry.track.id),
              ),
            ),
        ),
      ),
    )

  const editor = () =>
    h.div.key('library-editor').children(
      h.button
        .disabled(model.busy)
        .on('click', LibraryMessage.ClickedBack())
        .children('Back to list'),
      h.form
        .class('dashboard-form')
        .on('submit', LibraryMessage.ClickedAction({ action: 'save', trackId: '' }))
        .children(
          libraryFormFields(section).map(field),
          shows
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
              .children(shows ? 'Delete' : 'Delete playlist'),
            model.confirming ? confirmation() : undefined,
          )
        : undefined,
      !shows && model.selected
        ? h.div.children(
            h.h2('Tracks'),
            field('trackUrl'),
            action('add', 'Add Spotify track'),
            action('sync', 'Sync track links'),
            trackList(),
          )
        : undefined,
    )

  return h.section.class('admin-page').children(
    Notice(h, model.error, true),
    Notice(h, model.notice),
    failed
      ? h.p
          .attr('role', 'alert')
          .children('Could not refresh the current library data. Try again before editing.')
      : undefined,
    h.button
      .disabled(model.busy)
      .on('click', LibraryMessage.ClickedRefresh({ offset: model.offset }))
      .children('Refresh'),
    model.editor
      ? editor()
      : h.div.key('library-list').children(
          h.button
            .disabled(model.busy)
            .on('click', LibraryMessage.ClickedNew())
            .children(shows ? 'New show' : 'New playlist'),
          listing(),
          !shows
            ? h.details.children(
                h.summary('Import from Spotify'),
                h.div
                  .class('dashboard-form')
                  .children(field('importUrl'), action('import', 'Import playlist')),
              )
            : undefined,
        ),
    document.shows
      ? h.nav.attr('aria-label', 'Show pages').children(
          h.button
            .disabled(model.busy || model.offset === 0)
            .on('click', LibraryMessage.ClickedRefresh({ offset: Math.max(0, model.offset - 25) }))
            .children('Previous'),
          h.span(plural(document.shows.pagination.total, 'show')),
          h.button
            .disabled(model.busy || !document.shows.pagination.hasMore)
            .on('click', LibraryMessage.ClickedRefresh({ offset: model.offset + 25 }))
            .children('Next'),
        )
      : undefined,
  )
}
