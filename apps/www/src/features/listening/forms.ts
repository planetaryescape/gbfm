import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'
import type { SavedMix } from '@gbfm/api/listening'

import { HiddenField } from '../account/fields'

export const fieldClass =
  'w-full min-w-0 border border-border bg-card px-3 py-2.5 text-sm text-foreground'

export const buttonClass =
  'inline-flex min-h-11 items-center justify-center border border-border px-4 py-2 text-sm font-semibold hover:text-highlight'

export const Submit = <M>(h: Html.H<M>, text: string) =>
  h.button.attr('type', 'submit').class(buttonClass).children(text)

export const Field = <M>(h: Html.H<M>, name: string, label: string, value = '', required = false) =>
  h.label.class('grid gap-2 text-xs').children(
    label,
    h.input
      .attr('name', name)
      .attr('value', value)
      .attr('required', required ? '' : undefined)
      .attr('maxlength', '300')
      .class(fieldClass),
  )

export const Checkbox = <M>(h: Html.H<M>, name: string, label: string, checked = false) =>
  h.label.class('flex min-h-11 items-center gap-3 text-xs').children(
    h.input
      .attr('type', 'checkbox')
      .attr('name', name)
      .attr('value', 'true')
      .attr('checked', checked ? '' : undefined),
    label,
  )

export const ListeningAction = <M, C extends View.Children<M>>(
  h: Html.H<M>,
  operation: string,
  returnTo: string,
  children: C,
) =>
  h.form
    .attr('method', 'post')
    .attr('action', `/actions/listening/${operation}`)
    .class('grid gap-3')
    .children(HiddenField(h, 'returnTo', returnTo), children)

export const MixSource = <M>(h: Html.H<M>, mix: SavedMix) =>
  h.div
    .class('flex flex-wrap items-center justify-between gap-3 text-xs')
    .children(
      h.span.class('text-muted-foreground capitalize').children(mix.platform),
      h.a
        .attr('href', mix.url)
        .attr('target', '_blank')
        .attr('rel', 'noopener noreferrer')
        .children('Open on original platform ↗'),
    )

export const MixEmbed = <M>(h: Html.H<M>, mix: SavedMix) =>
  mix.embedUrl
    ? h.details
        .class('border-t border-border')
        .children(
          h.summary.class('cursor-pointer py-3 text-xs').children('Listen here'),
          h.iframe
            .attr('src', mix.embedUrl)
            .attr('title', `Listen to ${mix.title}`)
            .attr('loading', 'lazy')
            .attr('allow', 'encrypted-media; fullscreen; picture-in-picture')
            .class('mb-4 h-64 w-full border-0 bg-background'),
        )
    : null

export const deskHref = (collection = '', status = '', mix = '') => {
  const query = new URLSearchParams()

  if (collection) query.set('collection', collection)

  if (status) query.set('status', status)

  if (mix) query.set('mix', mix)

  return `/listening${query.size ? `?${query}` : ''}`
}
